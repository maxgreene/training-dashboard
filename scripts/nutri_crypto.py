"""Krypto fuer den Ernaehrungs-Tresor.

Ein einziger Datenschluessel (DEK, 32 Byte) verschluesselt das Logbuch mit
AES-256-GCM. Der DEK selbst liegt NIE im Repository. Er wird mehrfach
"eingewickelt" (wrap) abgelegt:

  - passphrase : PBKDF2-SHA256 ueber eine lange Passphrase  (Wiederherstellung)
  - prf        : WebAuthn-PRF-Ausgabe des Passkeys -> HKDF   (Face ID am Handy)

Die prf-Wraps entstehen im Browser, nicht hier. Dieses Modul liest sie nur
mit, damit `nutri.py` keys.json nicht zerstoert.

Gegenstueck im Browser: js/vault.js. Beide Seiten muessen bei jeder Aenderung
an Parametern (Iterationen, Info-String, Nonce-Laenge) gemeinsam angepasst
werden, sonst laesst sich der Tresor nicht mehr oeffnen.
"""

import base64
import json
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

VAULT_VERSION = 1
PBKDF2_ITERS = 600_000          # muss mit vault.js uebereinstimmen
NONCE_LEN = 12                  # AES-GCM Standard
DEK_LEN = 32                    # AES-256


def b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def b64d(txt: str) -> bytes:
    return base64.b64decode(txt)


def new_dek() -> bytes:
    return secrets.token_bytes(DEK_LEN)


def derive_passphrase_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERS,
    )
    return kdf.derive(passphrase.encode("utf-8"))


def wrap_dek_passphrase(dek: bytes, passphrase: str) -> dict:
    salt = secrets.token_bytes(16)
    key = derive_passphrase_key(passphrase, salt)
    nonce = secrets.token_bytes(NONCE_LEN)
    ct = AESGCM(key).encrypt(nonce, dek, None)
    return {
        "type": "passphrase",
        "label": "Wiederherstellung",
        "kdf": {"name": "PBKDF2-SHA256", "iterations": PBKDF2_ITERS, "salt": b64e(salt)},
        "nonce": b64e(nonce),
        "ct": b64e(ct),
    }


def unwrap_dek_passphrase(wrap: dict, passphrase: str) -> bytes:
    key = derive_passphrase_key(passphrase, b64d(wrap["kdf"]["salt"]))
    return AESGCM(key).decrypt(b64d(wrap["nonce"]), b64d(wrap["ct"]), None)


def encrypt_vault(plain: dict, dek: bytes) -> dict:
    """Klartext-Dict -> Datei-Inhalt fuer data/nutrition/log.enc.json."""
    nonce = secrets.token_bytes(NONCE_LEN)
    raw = json.dumps(plain, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct = AESGCM(dek).encrypt(nonce, raw, None)
    return {"v": VAULT_VERSION, "alg": "AES-256-GCM", "nonce": b64e(nonce), "ct": b64e(ct)}


def decrypt_vault(blob: dict, dek: bytes) -> dict:
    if blob.get("v") != VAULT_VERSION:
        raise ValueError(f"Unbekannte Tresor-Version: {blob.get('v')}")
    raw = AESGCM(dek).decrypt(b64d(blob["nonce"]), b64d(blob["ct"]), None)
    return json.loads(raw)


# ── Lokale Schluesseldatei ────────────────────────────────────────────────
# Liegt ausserhalb des Repos. Auf jedem Rechner, der schreiben soll, einmal
# anlegen. Ohne sie kann nichts geloggt werden; mit ihr allein kann jeder
# alles lesen, deshalb Modus 0600.

def key_path() -> Path:
    env = os.environ.get("NUTRI_KEY_FILE")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".config" / "nutri457" / "key"


def load_dek() -> bytes:
    p = key_path()
    if not p.exists():
        raise SystemExit(
            f"Kein Schluessel unter {p}.\n"
            "  nutri.py init      -> neuen Tresor anlegen\n"
            "  nutri.py import-key -> Schluessel von einem anderen Rechner uebernehmen"
        )
    # Unix-Rechte gibt es auf Windows nicht: Python meldet dort immer 0o666,
    # der Test wuerde also immer ausloesen. Auf Windows schuetzt stattdessen
    # die NTFS-ACL des Benutzerprofils.
    if os.name != "nt":
        mode = p.stat().st_mode & 0o777
        if mode & 0o077:
            raise SystemExit(f"{p} ist zu offen (Modus {mode:o}). Bitte: chmod 600 {p}")
    dek = b64d(p.read_text().strip())
    if len(dek) != DEK_LEN:
        raise SystemExit(f"Schluessel in {p} hat {len(dek)} statt {DEK_LEN} Byte.")
    return dek


def save_dek(dek: bytes) -> Path:
    p = key_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(b64e(dek) + "\n")
    if os.name != "nt":
        p.chmod(0o600)
    return p
