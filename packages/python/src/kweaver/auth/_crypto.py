"""RSA PKCS#1 v1.5 helpers for /oauth2/signin (1:1 with TS oauth.ts)."""
from __future__ import annotations

import base64

from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    load_pem_public_key,
)

# Studioweb hardcoded LOGIN public key — fixed across KWeaver deployments.
# Source: kweaver-ai/kweaver deploy/auto_cofig/auto_config.sh LOGIN_PUBLIC_KEY.
STUDIOWEB_LOGIN_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsyOstgbYuubBi2PUqeVj
GKlkwVUY6w1Y8d4k116dI2SkZI8fxcjHALv77kItO4jYLVplk9gO4HAtsisnNE2o
wlYIqdmyEPMwupaeFFFcg751oiTXJiYbtX7ABzU5KQYPjRSEjMq6i5qu/mL67XTk
hvKwrC83zme66qaKApmKupDODPb0RRkutK/zHfd1zL7sciBQ6psnNadh8pE24w8O
2XVy1v2bgSNkGHABgncR7seyIg81JQ3c/Axxd6GsTztjLnlvGAlmT1TphE84mi99
fUaGD2A1u1qdIuNc+XuisFeNcUW6fct0+x97eS2eEGRr/7qxWmO/P20sFVzXc2bF
1QIDAQAB
-----END PUBLIC KEY-----"""

# DIP / EACP / AnyShare 1024-bit ISFWeb fallback when __NEXT_DATA__ has no publicKey.
DEFAULT_SIGNIN_RSA_MODULUS_HEX = (
    "C1D9F84B95AF6B331FBA2D64D76A39CAD7529DA79DB4B3543E4DF3DF21723FEC"
    "6F7E2F6602E11037339AE0462DF6B39F94150FC256A505A8CA95BB3699E25C3F"
    "B84764D6A1DC3F483A2C1DC4F70925D85725151D0CFBF1EB5A6C4FA0E37ED32F"
    "ED150C717CD82C528745CDB761D17635AC855421B3CBBEE7D405B2CA5C70CFA7"
)


def rsa_modulus_hex_to_spki_pem(modulus_hex: str, exponent: int = 65537) -> str:
    """Build an SPKI PEM from an RSA modulus (hex). Matches TS rsaModulusHexToSpkiPem."""
    if len(modulus_hex) % 2 != 0:
        raise ValueError("modulus hex must be even-length")
    n = int(modulus_hex, 16)
    pub = RSAPublicNumbers(e=exponent, n=n).public_key()
    return pub.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode()


def encrypt_pkcs1_v15(plain: str, public_key_pem: str) -> str:
    """RSA PKCS#1 v1.5 encrypt + base64. Matches TS publicEncrypt(RSA_PKCS1_PADDING)."""
    try:
        key = load_pem_public_key(public_key_pem.encode())
        cipher = key.encrypt(plain.encode(), padding.PKCS1v15())
    except Exception as exc:
        raise RuntimeError(f"Failed to encrypt password with provided public key: {exc}") from exc
    return base64.b64encode(cipher).decode()
