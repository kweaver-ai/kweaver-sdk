"""Public auth API. Re-exports grow incrementally per task."""
from __future__ import annotations

from kweaver.auth._crypto import (
    DEFAULT_SIGNIN_RSA_MODULUS_HEX,
    STUDIOWEB_LOGIN_PUBLIC_KEY_PEM,
    encrypt_pkcs1_v15,
    rsa_modulus_hex_to_spki_pem,
)
from kweaver.auth._http_signin import http_signin
from kweaver.auth._signin_html import parse_signin_page_html_props
from kweaver.auth.eacp import (
    EacpModifyPasswordResult,
    InitialPasswordChangeRequiredError,
    eacp_modify_password,
    encrypt_modify_pwd,
    fetch_eacp_user_info,
)

__all__ = [
    "DEFAULT_SIGNIN_RSA_MODULUS_HEX",
    "STUDIOWEB_LOGIN_PUBLIC_KEY_PEM",
    "EacpModifyPasswordResult",
    "InitialPasswordChangeRequiredError",
    "eacp_modify_password",
    "encrypt_modify_pwd",
    "encrypt_pkcs1_v15",
    "fetch_eacp_user_info",
    "http_signin",
    "parse_signin_page_html_props",
    "rsa_modulus_hex_to_spki_pem",
]
