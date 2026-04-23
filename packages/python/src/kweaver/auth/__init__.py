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

# User-facing alias — `eacp_modify_password` exposes an internal product code name
# (EACP = the platform's underlying account service). New code should prefer
# ``change_password``; the old name stays for backwards compatibility.
change_password = eacp_modify_password
ChangePasswordResult = EacpModifyPasswordResult
from kweaver.auth.store_helpers import (
    NO_AUTH_TOKEN,
    ExportedCredentials,
    PlatformInfoDict,
    UserProfile,
    WhoamiInfo,
    export_credentials,
    get_active_user,
    is_no_auth,
    list_platforms,
    list_users,
    save_no_auth_platform,
    set_active_user,
    whoami,
)

__all__ = [
    "DEFAULT_SIGNIN_RSA_MODULUS_HEX",
    "STUDIOWEB_LOGIN_PUBLIC_KEY_PEM",
    "ChangePasswordResult",
    "EacpModifyPasswordResult",
    "ExportedCredentials",
    "InitialPasswordChangeRequiredError",
    "NO_AUTH_TOKEN",
    "PlatformInfoDict",
    "UserProfile",
    "WhoamiInfo",
    "change_password",
    "eacp_modify_password",
    "encrypt_modify_pwd",
    "encrypt_pkcs1_v15",
    "export_credentials",
    "fetch_eacp_user_info",
    "get_active_user",
    "http_signin",
    "is_no_auth",
    "list_platforms",
    "list_users",
    "parse_signin_page_html_props",
    "rsa_modulus_hex_to_spki_pem",
    "save_no_auth_platform",
    "set_active_user",
    "whoami",
]
