"""TS↔Python byte-equality fixtures.

Fixtures are produced by packages/typescript/test/dump-signin-fixtures.ts
(or the equivalent Python generator — same algorithms as TS).
Re-run the TS script when bumping signin/RSA logic in TS or Python.
"""
from __future__ import annotations

import json
from pathlib import Path

from kweaver.auth._crypto import DEFAULT_SIGNIN_RSA_MODULUS_HEX, rsa_modulus_hex_to_spki_pem
from kweaver.auth._http_signin import _build_signin_post_body

FIX = Path(__file__).resolve().parent.parent.parent / "fixtures"


def test_signin_post_body_byte_equal_with_ts() -> None:
    expected = json.loads((FIX / "signin_post_body_basic.json").read_text(encoding="utf-8"))
    actual = _build_signin_post_body(
        csrftoken="CSRF_FIXTURE",
        challenge="CHALLENGE_FIXTURE",
        account="alice",
        password_cipher="CIPHER_FIXTURE",
        remember=False,
    )
    assert actual == expected


def test_default_modulus_pem_byte_equal_with_ts() -> None:
    expected = (FIX / "spki_default_modulus.pem").read_text(encoding="utf-8")
    actual = rsa_modulus_hex_to_spki_pem(DEFAULT_SIGNIN_RSA_MODULUS_HEX)
    assert actual.strip() == expected.strip()
