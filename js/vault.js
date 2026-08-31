/* vault.js — Entsperren und Entschluesseln des Ernaehrungs-Logbuchs.
 *
 * Der Passkey meldet hier niemanden an. Es gibt keinen Server, an dem man
 * sich anmelden koennte. Der Passkey wird als Schluesselableiter benutzt:
 * die WebAuthn-PRF-Erweiterung liefert fuer denselben Salt immer dieselben
 * 32 Byte, und Face ID bewacht den Zugriff darauf. Aus diesen Bytes wird
 * per HKDF ein Schluessel, der den eigentlichen Datenschluessel (DEK)
 * auswickelt. Der DEK entschluesselt log.enc.json.
 *
 * Damit ist der Chiffretext oeffentlich (das Repo ist oeffentlich) und
 * trotzdem nur mit deinem Geraet oder deiner Passphrase lesbar.
 *
 * Gegenstueck: scripts/nutri_crypto.py. Parameter muessen identisch bleiben.
 */

const Vault = (() => {
  const PBKDF2_ITERS = 600000;         // == nutri_crypto.PBKDF2_ITERS
  const HKDF_INFO = 'nutri457-dek-wrap';
  const enc = new TextEncoder();

  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const b64e = b => btoa(String.fromCharCode(...new Uint8Array(b)));

  async function aesKey(raw, usages) {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
  }

  async function unwrap(wrap, keyMaterial) {
    const k = await aesKey(keyMaterial, ['decrypt']);
    const dek = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64d(wrap.nonce) }, k, b64d(wrap.ct));
    return new Uint8Array(dek);
  }

  async function wrap(dek, keyMaterial, meta) {
    const k = await aesKey(keyMaterial, ['encrypt']);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, dek);
    return Object.assign({ nonce: b64e(nonce), ct: b64e(ct) }, meta);
  }

  // ── Passphrase ──────────────────────────────────────────────────────────
  async function passphraseKey(pw, salt, iters) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, base, 256);
  }

  async function unlockWithPassphrase(keys, pw) {
    const w = keys.wraps.find(x => x.type === 'passphrase');
    if (!w) throw new Error('Kein Passphrase-Wrap hinterlegt.');
    const km = await passphraseKey(pw, b64d(w.kdf.salt), w.kdf.iterations);
    try {
      return await unwrap(w, km);
    } catch { throw new Error('Passphrase falsch.'); }
  }

  // ── Passkey / PRF ───────────────────────────────────────────────────────
  // Apple liefert PRF nur im Flow auf demselben Geraet zuverlaessig. Ueber
  // den QR-Code auf ein anderes Geraet kommt teils ein leeres Ergebnis
  // zurueck. Deshalb pro Geraet ein eigener Passkey und ein eigener Wrap.
  function prfSalt(keys) { return enc.encode(keys.prfSalt || 'nutri457-dek-v1'); }

  async function prfBits(keys, credentialId) {
    const opts = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt(keys) } } }
    };
    if (credentialId) opts.allowCredentials = [{ type: 'public-key', id: b64d(credentialId) }];
    const cred = await navigator.credentials.get({ publicKey: opts });
    const res = cred.getClientExtensionResults();
    if (!res.prf || !res.prf.results || !res.prf.results.first) {
      throw new Error('Dieses Geraet liefert kein PRF-Ergebnis. Passphrase benutzen.');
    }
    return { bits: res.prf.results.first, id: b64e(cred.rawId) };
  }

  async function hkdf(bits, saltBytes) {
    const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
    return crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: enc.encode(HKDF_INFO) }, base, 256);
  }

  async function unlockWithPasskey(keys) {
    const prfWraps = keys.wraps.filter(w => w.type === 'prf');
    if (!prfWraps.length) throw new Error('Noch kein Passkey hinterlegt.');
    const { bits, id } = await prfBits(keys, null);
    const w = prfWraps.find(x => x.credentialId === id) || prfWraps[0];
    const km = await hkdf(bits, b64d(w.hkdfSalt));
    try {
      return await unwrap(w, km);
    } catch { throw new Error('Dieser Passkey passt nicht zu diesem Tresor.'); }
  }

  /* Neuen Passkey fuer dieses Geraet anlegen. Setzt voraus, dass der Tresor
   * schon offen ist (der DEK also vorliegt) — typischerweise direkt nach dem
   * Entsperren per Passphrase. Ergebnis ist ein Wrap-Block, der per
   * `nutri.py add-wrap` ins Repo wandert. Der Browser kann nicht committen. */
  async function enrollPasskey(keys, dek, label) {
    const userId = crypto.getRandomValues(new Uint8Array(16));
    await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Training Dashboard' },
        user: { id: userId, name: label, displayName: label },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: {} }
      }
    });
    // Anlegen liefert die PRF-Ausgabe nicht auf allen Plattformen mit,
    // deshalb direkt danach ein regulaerer get().
    const { bits, id } = await prfBits(keys, null);
    const hkdfSalt = crypto.getRandomValues(new Uint8Array(16));
    const km = await hkdf(bits, hkdfSalt);
    return await wrap(dek, km, {
      type: 'prf', label, credentialId: id, hkdfSalt: b64e(hkdfSalt)
    });
  }

  // ── Tresor ──────────────────────────────────────────────────────────────
  async function open(blob, dek) {
    if (blob.v !== 1) throw new Error('Unbekannte Tresor-Version ' + blob.v);
    const k = await aesKey(dek, ['decrypt']);
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64d(blob.nonce) }, k, b64d(blob.ct));
    return JSON.parse(new TextDecoder().decode(raw));
  }

  function prfAvailable() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }

  return { unlockWithPasskey, unlockWithPassphrase, enrollPasskey, open, prfAvailable, b64e };
})();
