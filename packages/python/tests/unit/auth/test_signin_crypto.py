"""RSA helpers for signin: PKCS#1 v1.5 encryption + modulus → SPKI PEM."""
from __future__ import annotations

import base64

import pytest

from kweaver.auth._crypto import (
    DEFAULT_SIGNIN_RSA_MODULUS_HEX,
    STUDIOWEB_LOGIN_PUBLIC_KEY_PEM,
    encrypt_pkcs1_v15,
    rsa_modulus_hex_to_spki_pem,
)


def test_studioweb_login_public_key_is_valid_2048_rsa() -> None:
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    key = load_pem_public_key(STUDIOWEB_LOGIN_PUBLIC_KEY_PEM.encode())
    assert key.key_size == 2048


def test_rsa_modulus_hex_to_spki_pem_roundtrip() -> None:
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    pem = rsa_modulus_hex_to_spki_pem(DEFAULT_SIGNIN_RSA_MODULUS_HEX)
    assert "BEGIN PUBLIC KEY" in pem
    assert "END PUBLIC KEY" in pem
    key = load_pem_public_key(pem.encode())
    assert key.key_size == 1024


def test_rsa_modulus_hex_to_spki_pem_rejects_odd_length() -> None:
    with pytest.raises(ValueError, match="even-length"):
        rsa_modulus_hex_to_spki_pem("abc")


def test_encrypt_pkcs1_v15_roundtrip_with_studioweb_key(tmp_path) -> None:
    """Smoke test: encrypt with the public PEM, decrypt with a generated keypair."""
    from cryptography.hazmat.primitives.asymmetric import rsa, padding
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        NoEncryption,
        PrivateFormat,
        PublicFormat,
    )

    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_pub = priv.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode()
    cipher_b64 = encrypt_pkcs1_v15("hunter2", pem_pub)
    plain = priv.decrypt(base64.b64decode(cipher_b64), padding.PKCS1v15())
    assert plain == b"hunter2"


def test_encrypt_pkcs1_v15_invalid_pem_raises() -> None:
    with pytest.raises(RuntimeError, match="encrypt password"):
        encrypt_pkcs1_v15("x", "not a pem")
