# Python Auth Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Python SDK feature-equivalent to TS `auth/oauth.ts` (HTTP signin + RSA + 401001017 + EACP change-password + multi-user helpers + no-auth) without depending on the TS CLI or Playwright; drop the dead `kweaver.cli` package and `PasswordAuth`.

**Architecture:** A new `kweaver.auth` subpackage with 6 small focused files (`_crypto`, `_signin_html`, `_http_signin`, `eacp`, `store_helpers`, `__init__`); a thin `HttpSigninAuth` provider in `_auth.py`; a top-level `kweaver.login(...)` convenience that dispatches to the right strategy. All public API uses keyword-only args, raises typed exceptions, never prints.

**Tech Stack:** Python 3.10+, `httpx`, `cryptography>=42` (already a dep), `pytest`, `pytest-respx` (new dev dep) for HTTP mocking.

**Spec:** `docs/superpowers/specs/2026-04-22-python-auth-parity-design.md`

---

## Test environment (use throughout)

All `pip` / `pytest` / `python` commands MUST use the existing venv at
`packages/python/.venv` so we don't pollute the system interpreter:

```bash
# from repo root
export PY=$(pwd)/packages/python/.venv/bin/python
export PIP="$PY -m pip"
export PYTEST="$PY -m pytest"
```

Whenever a step says `pytest …` it means `$PYTEST …`; whenever it says
`pip install …` it means `$PIP install …`. The venv already has
`httpx, cryptography, pytest, pytest-cov, pydantic, playwright` and an editable
install of `kweaver-sdk 0.6.6` — only `respx` is missing (Task 0 step 2).

When changing `pyproject.toml` deps, re-sync with:

```bash
$PIP install -e 'packages/python[dev]'
```

> The `playwright` package will remain installed in the venv after Task 12
> (cleanup) because we only remove it from `pyproject.toml`; uninstall it
> manually with `$PIP uninstall -y playwright` if you want a clean check.

---

## Task 0: Branch + dev fixtures + respx dep

**Files:**
- Modify: `packages/python/pyproject.toml` (add `respx` to dev deps)
- Create: `packages/python/tests/unit/auth/__init__.py`
- Create: `packages/python/tests/unit/auth/conftest.py`
- Create: `packages/python/tests/fixtures/__init__.py` (empty marker)

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/python-auth-parity
```

- [ ] **Step 2: Add respx to dev deps**

In `packages/python/pyproject.toml` change:

```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-cov>=5.0",
    "respx>=0.21",
]
```

Also remove `playwright` from `[dependency-groups].dev` (will be re-added empty in Task 11):

```toml
[dependency-groups]
dev = []
```

- [ ] **Step 3: Create test scaffolding**

`packages/python/tests/unit/auth/__init__.py`:

```python
```

`packages/python/tests/unit/auth/conftest.py`:

```python
"""Shared fixtures for auth/* tests."""
from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture
def tmp_kweaver_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated ~/.kweaver/ for each test."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr("pathlib.Path.home", lambda: home)
    yield home
```

- [ ] **Step 4: Install + verify**

```bash
$PIP install -e 'packages/python[dev]'
pytest tests/unit/auth -v
```
Expected: 0 tests collected, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/python/pyproject.toml packages/python/tests/unit/auth/
git commit -m "test(auth): scaffold auth test directory + add respx dev dep"
```

---

## Task 1: `kweaver.auth._crypto` — RSA PKCS#1 v1.5 + modulus→PEM

**Files:**
- Create: `packages/python/src/kweaver/auth/__init__.py`
- Create: `packages/python/src/kweaver/auth/_crypto.py`
- Create: `packages/python/tests/unit/auth/test_signin_crypto.py`

- [ ] **Step 1: Write failing tests**

`packages/python/tests/unit/auth/test_signin_crypto.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
$PYTEST tests/unit/auth/test_signin_crypto.py -v
```
Expected: ImportError / ModuleNotFoundError on `kweaver.auth._crypto`.

- [ ] **Step 3: Implement `_crypto.py`**

`packages/python/src/kweaver/auth/__init__.py`:

```python
"""Public auth API. Re-exports grow incrementally per task."""
from __future__ import annotations

from kweaver.auth._crypto import (
    DEFAULT_SIGNIN_RSA_MODULUS_HEX,
    STUDIOWEB_LOGIN_PUBLIC_KEY_PEM,
    encrypt_pkcs1_v15,
    rsa_modulus_hex_to_spki_pem,
)

__all__ = [
    "DEFAULT_SIGNIN_RSA_MODULUS_HEX",
    "STUDIOWEB_LOGIN_PUBLIC_KEY_PEM",
    "encrypt_pkcs1_v15",
    "rsa_modulus_hex_to_spki_pem",
]
```

`packages/python/src/kweaver/auth/_crypto.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
$PYTEST tests/unit/auth/test_signin_crypto.py -v
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/auth/__init__.py \
        packages/python/src/kweaver/auth/_crypto.py \
        packages/python/tests/unit/auth/test_signin_crypto.py
git commit -m "feat(auth): RSA PKCS#1 v1.5 helpers + studioweb/DIP signin keys"
```

---

## Task 2: `kweaver.auth._signin_html` — Next.js `__NEXT_DATA__` parser

**Files:**
- Create: `packages/python/src/kweaver/auth/_signin_html.py`
- Modify: `packages/python/src/kweaver/auth/__init__.py`
- Create: `packages/python/tests/unit/auth/test_signin_html.py`

- [ ] **Step 1: Write failing tests**

`packages/python/tests/unit/auth/test_signin_html.py`:

```python
"""Tests for _signin_html.parse_signin_page_html_props.

Mirror of packages/typescript/test/oauth-signin-html.test.ts — keep these
test names in lock-step with the TS suite for parity audits.
"""
from __future__ import annotations

import json

import pytest

from kweaver.auth._signin_html import parse_signin_page_html_props

SPKI_FIXTURE = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4E+eiWRwffhRIPQYvlXUjf0b3HqCmosi"
    "CxbFCYI/gdfDBhrTUzbt3fL3o/gRQQBEPf69vhJMFH2ZMtaJM6ohE3yQef331liPVM0YvqMOgvoI"
    "D+zDa1NIZFObSsjOKhvZtv9esO0REeiVEPKNc+Dp6il3x7TV9VKGEv0+iriNjqv7TGAexo2jVtLm"
    "50iVKTju2qmCDG83SnVHzsiNj70MiviqiLpgz72IxjF+xN4bRw8I5dD0GwwO8kDoJUGWgTds+Vck"
    "Cwdt"
    "ZA65oui9Osk5t1a4pg6Xu9+HFcEuqwJTDxATvGAz1/YW0oUisjM0ObKTRDVSfnTYeaBsN6L+M+8g"
    "CwIDAQAB"
)


def _wrap(data: dict) -> str:
    return (
        '<!DOCTYPE html><script id="__NEXT_DATA__" type="application/json">'
        + json.dumps(data)
        + "</script>"
    )


def test_csrftoken_and_challenge() -> None:
    html = _wrap({"props": {"pageProps": {"challenge": "ch1", "csrftoken": "csrf1"}}})
    o = parse_signin_page_html_props(html)
    assert o["challenge"] == "ch1"
    assert o["csrftoken"] == "csrf1"
    assert o["remember"] is None


def test_accepts_underscore_csrf_instead_of_csrftoken() -> None:
    html = _wrap({"props": {"pageProps": {"challenge": "c", "_csrf": "x"}}})
    assert parse_signin_page_html_props(html)["csrftoken"] == "x"


def test_missing_next_data_throws() -> None:
    with pytest.raises(RuntimeError, match="__NEXT_DATA__"):
        parse_signin_page_html_props("<html></html>")


def test_missing_csrftoken_throws() -> None:
    html = _wrap({"props": {"pageProps": {"challenge": "c"}}})
    with pytest.raises(RuntimeError, match="csrftoken"):
        parse_signin_page_html_props(html)


def test_parses_remember_boolean() -> None:
    html = _wrap({"props": {"pageProps": {"challenge": "c", "csrftoken": "t", "remember": True}}})
    assert parse_signin_page_html_props(html)["remember"] is True


def test_parses_remember_string_true() -> None:
    html = _wrap({"props": {"pageProps": {"csrftoken": "t", "remember": "true"}}})
    assert parse_signin_page_html_props(html)["remember"] is True


def test_parses_public_key_hex_modulus_from_pageprops() -> None:
    html = _wrap({"props": {"pageProps": {"csrftoken": "t", "publicKey": "aabb"}}})
    assert parse_signin_page_html_props(html)["rsa_public_key_material"] == "aabb"


def test_finds_nested_base64_spki_in_pageprops() -> None:
    html = _wrap({
        "props": {"pageProps": {"csrftoken": "t", "auth": {"cfg": {"publicKey": SPKI_FIXTURE}}}}
    })
    assert parse_signin_page_html_props(html)["rsa_public_key_material"] == SPKI_FIXTURE


def test_regex_fallback_for_modulus_in_html() -> None:
    mod = "a" * 256
    html = (
        '<script id="__NEXT_DATA__" type="application/json">'
        + json.dumps({"props": {"pageProps": {"csrftoken": "t"}}})
        + f'</script>extra "modulus":"{mod}"'
    )
    assert parse_signin_page_html_props(html)["rsa_public_key_material"] == mod


def test_rsa_material_under_props_outside_pageprops() -> None:
    html = _wrap({
        "props": {
            "pageProps": {"csrftoken": "t", "challenge": "c"},
            "extra": {"rsaPublicKey": SPKI_FIXTURE},
        }
    })
    assert parse_signin_page_html_props(html)["rsa_public_key_material"] == SPKI_FIXTURE
```

- [ ] **Step 2: Run test to verify it fails**

```bash
$PYTEST tests/unit/auth/test_signin_html.py -v
```
Expected: ModuleNotFoundError on `kweaver.auth._signin_html`.

- [ ] **Step 3: Implement `_signin_html.py`**

`packages/python/src/kweaver/auth/_signin_html.py`:

```python
"""Parse Next.js __NEXT_DATA__ from /oauth2/signin HTML (1:1 with TS parseSigninPageHtmlProps)."""
from __future__ import annotations

import json
import re
from typing import Any, TypedDict

_NEXT_DATA_RE = re.compile(
    r'<script[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>([\s\S]*?)</script>',
    re.IGNORECASE,
)
_HTML_MODULUS_RE = re.compile(r'"modulus"\s*:\s*"([0-9a-fA-F]{200,})"')
_HTML_PUBKEY_RE = re.compile(r'"(?:publicKey|rsaPublicKey|encryptPublicKey)"\s*:\s*"([A-Za-z0-9+/=]{200,})"')

# Keys we look for inside pageProps (in order).
_PUBKEY_KEYS = (
    "publicKey", "rsaPublicKey", "public_key", "encryptPublicKey",
    "rsaModulus", "passwordPublicKey", "loginPublicKey", "pwdPublicKey",
    "encryptKey", "modulus",
)


class SigninPageProps(TypedDict, total=False):
    challenge: str | None
    csrftoken: str
    remember: bool | None
    rsa_public_key_material: str | None


def _extract_from_pageprops(pp: dict) -> str | None:
    for k in _PUBKEY_KEYS:
        v = pp.get(k)
        if isinstance(v, str) and len(v) >= 64:
            return v
    return None


def _deep_find(node: Any, depth: int, seen: set[int]) -> str | None:
    if depth <= 0 or id(node) in seen:
        return None
    seen.add(id(node))
    if isinstance(node, dict):
        for k, v in node.items():
            if k in _PUBKEY_KEYS and isinstance(v, str) and len(v) >= 64:
                return v
            r = _deep_find(v, depth - 1, seen)
            if r:
                return r
    elif isinstance(node, list):
        for v in node:
            r = _deep_find(v, depth - 1, seen)
            if r:
                return r
    return None


def _html_regex_fallback(html: str) -> str | None:
    m = _HTML_MODULUS_RE.search(html)
    if m:
        return m.group(1)
    m = _HTML_PUBKEY_RE.search(html)
    if m:
        return m.group(1)
    return None


def parse_signin_page_html_props(html: str) -> SigninPageProps:
    """Parse Next.js __NEXT_DATA__ from the OAuth2 sign-in HTML shell.

    Returns a dict with: challenge, csrftoken, remember, rsa_public_key_material.
    Raises RuntimeError when __NEXT_DATA__ or csrftoken is absent.
    """
    m = _NEXT_DATA_RE.search(html)
    if not m:
        raise RuntimeError("Could not find __NEXT_DATA__ on the sign-in page.")
    data = json.loads(m.group(1))
    page_props = (data.get("props") or {}).get("pageProps")
    if not isinstance(page_props, dict):
        raise RuntimeError("Invalid __NEXT_DATA__: missing pageProps.")
    csrftoken = page_props.get("csrftoken") or page_props.get("_csrf")
    if not isinstance(csrftoken, str):
        raise RuntimeError(
            "Sign-in page did not expose csrftoken (expected in __NEXT_DATA__.props.pageProps)."
        )
    challenge = page_props.get("challenge")
    challenge_str = challenge if isinstance(challenge, str) else None
    remember_raw = page_props.get("remember")
    if isinstance(remember_raw, bool):
        remember: bool | None = remember_raw
    elif isinstance(remember_raw, str):
        remember = remember_raw == "true"
    else:
        remember = None
    material = _extract_from_pageprops(page_props)
    if not material:
        material = _deep_find(data, 10, set())
    if not material:
        material = _html_regex_fallback(html)
    return {
        "challenge": challenge_str,
        "csrftoken": csrftoken,
        "remember": remember,
        "rsa_public_key_material": material,
    }
```

Update `packages/python/src/kweaver/auth/__init__.py` — add to imports and `__all__`:

```python
from kweaver.auth._signin_html import parse_signin_page_html_props
```

Append `"parse_signin_page_html_props",` to `__all__`.

- [ ] **Step 4: Run test to verify it passes**

```bash
$PYTEST tests/unit/auth/test_signin_html.py -v
```
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/auth/_signin_html.py \
        packages/python/src/kweaver/auth/__init__.py \
        packages/python/tests/unit/auth/test_signin_html.py
git commit -m "feat(auth): parse Next.js __NEXT_DATA__ from /oauth2/signin (TS parity)"
```

---

## Task 3: `kweaver.auth.eacp` — change-password + userinfo + InitialPasswordChangeRequiredError

**Files:**
- Create: `packages/python/src/kweaver/auth/eacp.py`
- Modify: `packages/python/src/kweaver/auth/__init__.py`
- Create: `packages/python/tests/unit/auth/test_eacp_modify_password.py`
- Create: `packages/python/tests/unit/auth/test_eacp_user_info.py`

- [ ] **Step 1: Write failing tests**

`packages/python/tests/unit/auth/test_eacp_modify_password.py`:

```python
"""Tests for eacp_modify_password (POST /api/eacp/v1/auth1/modifypassword)."""
from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx

from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_private_key

from kweaver.auth.eacp import (
    EACP_MODIFYPWD_PRIVATE_KEY_PEM,
    eacp_modify_password,
    encrypt_modify_pwd,
)


def _decrypt(cipher_b64: str) -> str:
    priv = load_pem_private_key(EACP_MODIFYPWD_PRIVATE_KEY_PEM.encode(), password=None)
    return priv.decrypt(base64.b64decode(cipher_b64), padding.PKCS1v15()).decode()


def test_encrypt_modify_pwd_roundtrip_with_embedded_key() -> None:
    cipher = encrypt_modify_pwd("hunter2")
    assert _decrypt(cipher) == "hunter2"


@respx.mock
def test_eacp_modify_password_sends_encrypted_payload() -> None:
    captured = {}

    def _capture(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"code": 0})

    respx.post("https://example.com/api/eacp/v1/auth1/modifypassword").mock(side_effect=_capture)

    res = eacp_modify_password(
        "https://example.com/", account="alice", old_password="old", new_password="new"
    )
    assert res["status"] == 200
    assert captured["body"]["account"] == "alice"
    assert captured["body"]["isforgetpwd"] is False
    assert captured["body"]["vcodeinfo"] == {"uuid": "", "vcode": ""}
    assert _decrypt(captured["body"]["oldpwd"]) == "old"
    assert _decrypt(captured["body"]["newpwd"]) == "new"


@respx.mock
def test_eacp_modify_password_propagates_4xx() -> None:
    respx.post("https://example.com/api/eacp/v1/auth1/modifypassword").mock(
        return_value=httpx.Response(400, json={"code": 1, "message": "weak"})
    )
    res = eacp_modify_password(
        "https://example.com", account="a", old_password="o", new_password="n"
    )
    assert res["status"] == 400
    assert res["ok"] is False
    assert res["json"] == {"code": 1, "message": "weak"}
```

`packages/python/tests/unit/auth/test_eacp_user_info.py`:

```python
"""Tests for fetch_eacp_user_info + InitialPasswordChangeRequiredError shape."""
from __future__ import annotations

import httpx
import pytest
import respx

from kweaver.auth.eacp import (
    InitialPasswordChangeRequiredError,
    fetch_eacp_user_info,
)


@respx.mock
def test_fetch_eacp_user_info_ok() -> None:
    respx.get("https://example.com/api/eacp/v1/user/get").mock(
        return_value=httpx.Response(200, json={"id": "u1", "account": "alice", "type": "user"})
    )
    info = fetch_eacp_user_info("https://example.com", access_token="tok")
    assert info["id"] == "u1"
    assert info["account"] == "alice"


@respx.mock
def test_fetch_eacp_user_info_returns_none_on_4xx() -> None:
    respx.get("https://example.com/api/eacp/v1/user/get").mock(
        return_value=httpx.Response(401, json={"code": 1})
    )
    assert fetch_eacp_user_info("https://example.com", access_token="tok") is None


def test_initial_password_change_required_error_fields() -> None:
    err = InitialPasswordChangeRequiredError(
        account="alice", base_url="https://x", server_message="must change"
    )
    assert err.code == 401001017
    assert err.http_status == 401
    assert err.account == "alice"
    assert err.base_url == "https://x"
    assert err.server_message == "must change"
    assert "must change" in str(err)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
$PYTEST tests/unit/auth/test_eacp_modify_password.py tests/unit/auth/test_eacp_user_info.py -v
```
Expected: ModuleNotFoundError on `kweaver.auth.eacp`.

- [ ] **Step 3: Implement `eacp.py`**

`packages/python/src/kweaver/auth/eacp.py`:

```python
"""EACP authentication helpers (modify password, userinfo, initial-password error).

1:1 port of packages/typescript/src/auth/eacp-modify-password.ts +
the InitialPasswordChangeRequiredError class from auth/oauth.ts.
"""
from __future__ import annotations

import base64
from typing import Any, TypedDict

import httpx

from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import (
    load_pem_private_key,
    load_pem_public_key,
)

# 1024-bit RSA private key embedded in ShareServer's eachttpserver — same
# keypair the C++ binary ships to every customer for /auth1/modifypassword.
# Source: isf/ShareServer/.../ncEACHttpServerUtil.cpp::RSADecrypt.
EACP_MODIFYPWD_PRIVATE_KEY_PEM = """-----BEGIN RSA PRIVATE KEY-----
MIICXgIBAAKBgQDB2fhLla9rMx+6LWTXajnK11Kdp520s1Q+TfPfIXI/7G9+L2YC
4RA3M5rgRi32s5+UFQ/CVqUFqMqVuzaZ4lw/uEdk1qHcP0g6LB3E9wkl2FclFR0M
+/HrWmxPoON+0y/tFQxxfNgsUodFzbdh0XY1rIVUIbPLvufUBbLKXHDPpwIDAQAB
AoGBALCM/H6ajXFs1nCR903aCVicUzoS9qckzI0SIhIOPCfMBp8+PAJTSJl9/ohU
YnhVj/kmVXwBvboxyJAmOcxdRPWL7iTk5nA1oiVXMer3Wby+tRg/ls91xQbJLVv3
oGSt7q0CXxJpRH2oYkVVlMMlZUwKz3ovHiLKAnhw+jEsdL2BAkEA9hA97yyeA2eq
f9dMu/ici99R3WJRRtk4NEI4WShtWPyziDg48d3SOzYmhEJjPuOo3g1ze01os70P
ApE7d0qcyQJBAMmt+FR8h5MwxPQPAzjh/fTuTttvUfBeMiUDrIycK1I/L96lH+fU
i4Nu+7TPOzExnPeGO5UJbZxrpIEUB7Zs8O8CQQCLzTCTGiNwxc5eMgH77kVrRudp
Q7nv6ex/7Hu9VDXEUFbkdyULbj9KuvppPJrMmWZROw04qgNp02mayM8jeLXZAkEA
o+PM/pMn9TPXiWE9xBbaMhUKXgXLd2KEq1GeAbHS/oY8l1hmYhV1vjwNLbSNrH9d
yEP73TQJL+jFiONHFTbYXwJAU03Xgum5mLIkX/02LpOrz2QCdfX1IMJk2iKi9osV
KqfbvHsF0+GvFGg18/FXStG9Kr4TjqLsygQJT76/MnMluw==
-----END RSA PRIVATE KEY-----"""

_cached_pub = None


def _embedded_public_key():
    global _cached_pub
    if _cached_pub is None:
        priv = load_pem_private_key(EACP_MODIFYPWD_PRIVATE_KEY_PEM.encode(), password=None)
        _cached_pub = priv.public_key()
    return _cached_pub


def encrypt_modify_pwd(plain: str, public_key_pem: str | None = None) -> str:
    """Encrypt with the EACP modifypassword RSA public key, base64-encoded."""
    key = (
        load_pem_public_key(public_key_pem.encode()) if public_key_pem else _embedded_public_key()
    )
    cipher = key.encrypt(plain.encode(), padding.PKCS1v15())
    return base64.b64encode(cipher).decode()


class EacpModifyPasswordResult(TypedDict):
    status: int
    ok: bool
    body: str
    json: Any


def eacp_modify_password(
    base_url: str,
    *,
    account: str,
    old_password: str,
    new_password: str,
    public_key_pem: str | None = None,
    tls_insecure: bool = False,
) -> EacpModifyPasswordResult:
    """Call EACP POST /api/eacp/v1/auth1/modifypassword (no bearer token required)."""
    body: dict[str, Any] = {
        "account": account,
        "oldpwd": encrypt_modify_pwd(old_password, public_key_pem),
        "newpwd": encrypt_modify_pwd(new_password, public_key_pem),
        "vcodeinfo": {"uuid": "", "vcode": ""},
        "isforgetpwd": False,
    }
    url = base_url.rstrip("/") + "/api/eacp/v1/auth1/modifypassword"
    resp = httpx.post(
        url,
        json=body,
        headers={"Accept": "application/json, text/plain, */*"},
        verify=not tls_insecure,
    )
    text = resp.text
    parsed: Any = None
    try:
        parsed = resp.json() if text else None
    except Exception:
        parsed = None
    return {"status": resp.status_code, "ok": resp.is_success, "body": text, "json": parsed}


def fetch_eacp_user_info(
    base_url: str, *, access_token: str, tls_insecure: bool = False
) -> dict[str, Any] | None:
    """Best-effort fetch of EACP userinfo. Returns None on non-200 / network error."""
    try:
        resp = httpx.get(
            base_url.rstrip("/") + "/api/eacp/v1/user/get",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            verify=not tls_insecure,
        )
        if resp.status_code != 200:
            return None
        info = resp.json()
        return info if isinstance(info, dict) else None
    except Exception:
        return None


class InitialPasswordChangeRequiredError(RuntimeError):
    """Raised on POST /oauth2/signin returning 401 with EACP code 401001017."""

    code: int = 401001017
    http_status: int = 401

    def __init__(self, *, account: str, base_url: str, server_message: str) -> None:
        super().__init__(server_message)
        self.account = account
        self.base_url = base_url
        self.server_message = server_message
```

Update `packages/python/src/kweaver/auth/__init__.py` — add:

```python
from kweaver.auth.eacp import (
    EacpModifyPasswordResult,
    InitialPasswordChangeRequiredError,
    eacp_modify_password,
    encrypt_modify_pwd,
    fetch_eacp_user_info,
)
```

Append the 5 names to `__all__`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
$PYTEST tests/unit/auth/test_eacp_modify_password.py tests/unit/auth/test_eacp_user_info.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/auth/eacp.py \
        packages/python/src/kweaver/auth/__init__.py \
        packages/python/tests/unit/auth/test_eacp_modify_password.py \
        packages/python/tests/unit/auth/test_eacp_user_info.py
git commit -m "feat(auth): EACP modify-password + userinfo + 401001017 error"
```

---

## Task 4: `kweaver.auth._http_signin` — happy path

**Files:**
- Create: `packages/python/src/kweaver/auth/_http_signin.py`
- Modify: `packages/python/src/kweaver/auth/__init__.py`
- Create: `packages/python/tests/unit/auth/test_http_signin.py`

> **Note:** This task focuses on happy path only. 401001017 retry is Task 5; no-auth fallback is Task 6.

- [ ] **Step 1: Write failing test (happy path only)**

`packages/python/tests/unit/auth/test_http_signin.py`:

```python
"""Tests for http_signin (HTTP /oauth2/signin + RSA password + redirect chain)."""
from __future__ import annotations

import base64
import json
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
import pytest
import respx

from kweaver.auth import http_signin
from kweaver.auth._crypto import STUDIOWEB_LOGIN_PUBLIC_KEY_PEM


def _signin_html(csrf: str, challenge: str) -> str:
    return (
        '<script id="__NEXT_DATA__" type="application/json">'
        + json.dumps({"props": {"pageProps": {"challenge": challenge, "csrftoken": csrf}}})
        + "</script>"
    )


@respx.mock
def test_http_signin_happy_path(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    redirect_uri = "http://127.0.0.1:9010/callback"

    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(200, text="ok"))
    respx.get(f"{base}/api/dip-hub/v1/login").mock(
        return_value=httpx.Response(
            302,
            headers={"location": f"{base}/oauth2/signin?login_challenge=xc"},
            text="",
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf123", "xc"))
    )

    captured = {}

    def _on_signin_post(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            302, headers={"location": f"{redirect_uri}?code=AUTHCODE&state=STATE"}
        )

    respx.post(f"{base}/oauth2/signin").mock(side_effect=_on_signin_post)
    respx.post(f"{base}/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "AT",
                "refresh_token": "RT",
                "id_token": "IT",
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": "openid offline all",
            },
        )
    )

    token = http_signin(base, username="alice", password="hunter2")

    assert token["accessToken"] == "AT"
    assert token["refreshToken"] == "RT"
    assert captured["body"]["account"] == "alice"
    assert captured["body"]["_csrf"] == "csrf123"
    assert captured["body"]["challenge"] == "xc"
    assert captured["body"]["device"]["client_type"] == "console_web"
    # password is RSA-encrypted base64 (we cannot decrypt without private key but assert shape)
    cipher = base64.b64decode(captured["body"]["password"])
    assert len(cipher) == 256  # 2048-bit RSA block
```

- [ ] **Step 2: Run test to verify it fails**

```bash
$PYTEST tests/unit/auth/test_http_signin.py::test_http_signin_happy_path -v
```
Expected: ImportError on `http_signin`.

- [ ] **Step 3: Implement `_http_signin.py` (happy path)**

`packages/python/src/kweaver/auth/_http_signin.py`:

```python
"""HTTP /oauth2/signin login: GET signin page, RSA-encrypt password, POST signin,
follow redirects to /callback?code=..., exchange code for token. 1:1 with TS
oauth2PasswordSigninLogin.
"""
from __future__ import annotations

import base64
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from kweaver.auth._crypto import (
    STUDIOWEB_LOGIN_PUBLIC_KEY_PEM,
    encrypt_pkcs1_v15,
    rsa_modulus_hex_to_spki_pem,
)
from kweaver.auth._signin_html import parse_signin_page_html_props
from kweaver.auth.eacp import InitialPasswordChangeRequiredError
from kweaver.config.store import PlatformStore

_DEFAULT_REDIRECT_PORT = 9010
_DEFAULT_SCOPE = "openid offline all"


def _resolve_public_key_pem(
    explicit: str | None, page_material: str | None
) -> str:
    """Public-key priority: arg > env file > page __NEXT_DATA__ > STUDIOWEB constant."""
    if explicit:
        return explicit
    env_path = os.environ.get("KWEAVER_SIGNIN_RSA_PUBLIC_KEY", "").strip()
    if env_path:
        with open(env_path, "r", encoding="utf-8") as fh:
            return fh.read()
    if page_material:
        s = page_material.strip()
        if "BEGIN PUBLIC KEY" in s:
            return s
        # All-hex modulus
        if all(c in "0123456789abcdefABCDEF" for c in s) and len(s) % 2 == 0:
            return rsa_modulus_hex_to_spki_pem(s)
        # Base64 SPKI: wrap to PEM
        return f"-----BEGIN PUBLIC KEY-----\n{s}\n-----END PUBLIC KEY-----"
    return STUDIOWEB_LOGIN_PUBLIC_KEY_PEM


def _build_signin_post_body(
    *, csrftoken: str, challenge: str, account: str, password_cipher: str, remember: bool
) -> dict[str, Any]:
    return {
        "_csrf": csrftoken,
        "challenge": challenge,
        "account": account,
        "password": password_cipher,
        "vcode": {"id": "", "content": ""},
        "dualfactorauthinfo": {"validcode": {"vcode": ""}, "OTP": {"OTP": ""}},
        "remember": remember,
        "device": {
            "name": "",
            "description": "",
            "client_type": "console_web",
            "udids": [],
        },
    }


def _resolve_or_register_client(
    base: str, port: int, *, tls_insecure: bool
) -> dict[str, Any]:
    """Reuse cached client.json if present and still valid; otherwise register."""
    store = PlatformStore()
    redirect_uri = f"http://127.0.0.1:{port}/callback"
    cached = store.load_client(base)
    if cached.get("clientId") and cached.get("redirectUri") == redirect_uri:
        # Pre-flight against /oauth2/auth — same trick as TS _is_client_still_valid
        try:
            r = httpx.get(
                f"{base}/oauth2/auth",
                params={
                    "client_id": cached["clientId"],
                    "response_type": "code",
                    "scope": "openid",
                    "redirect_uri": redirect_uri,
                    "state": "preflight",
                },
                follow_redirects=False,
                verify=not tls_insecure,
            )
            if r.status_code < 400:
                return cached
        except Exception:
            return cached
    # Register fresh
    resp = httpx.post(
        f"{base}/oauth2/clients",
        json={
            "client_name": "kweaver-sdk",
            "grant_types": ["authorization_code", "implicit", "refresh_token"],
            "response_types": ["token id_token", "code", "token"],
            "scope": "openid offline all",
            "redirect_uris": [redirect_uri],
            "post_logout_redirect_uris": [redirect_uri.rsplit("/", 1)[0] + "/successful-logout"],
            "metadata": {"device": {"name": "kweaver-sdk", "client_type": "web"}},
        },
        verify=not tls_insecure,
    )
    resp.raise_for_status()
    data = resp.json()
    client = {
        "baseUrl": base,
        "clientId": data["client_id"],
        "clientSecret": data["client_secret"],
        "redirectUri": redirect_uri,
        "scope": _DEFAULT_SCOPE,
        "lang": "zh-cn",
        "product": "adp",
    }
    store.save_client(base, client)
    return client


def _exchange_code(
    base: str, *, code: str, client_id: str, client_secret: str, redirect_uri: str,
    tls_insecure: bool,
) -> dict[str, Any]:
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = httpx.post(
        f"{base}/oauth2/token",
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        verify=not tls_insecure,
    )
    resp.raise_for_status()
    data = resp.json()
    now = datetime.now(timezone.utc)
    expires_in = int(data.get("expires_in", 3600))
    return {
        "baseUrl": base,
        "accessToken": data["access_token"],
        "tokenType": data.get("token_type", "Bearer"),
        "scope": data.get("scope", ""),
        "expiresIn": expires_in,
        "expiresAt": (now + timedelta(seconds=expires_in)).isoformat(),
        "refreshToken": data.get("refresh_token", ""),
        "idToken": data.get("id_token", ""),
        "obtainedAt": now.isoformat(),
    }


def http_signin(
    base_url: str,
    *,
    username: str,
    password: str,
    client_id: str | None = None,
    client_secret: str | None = None,
    new_password: str | None = None,
    signin_public_key_pem: str | None = None,
    tls_insecure: bool = False,
    lang: str = "zh-cn",
    redirect_port: int = _DEFAULT_REDIRECT_PORT,
    _retry_count: int = 0,
) -> dict[str, Any]:
    """HTTP /oauth2/signin login. See spec for full semantics."""
    if not isinstance(username, str) or not username:
        raise ValueError("username must be a non-empty string")
    if not isinstance(password, str) or not password:
        raise ValueError("password must be a non-empty string")

    base = base_url.rstrip("/")

    # 1. Resolve / register OAuth2 client
    if client_id and client_secret:
        client = {
            "clientId": client_id,
            "clientSecret": client_secret,
            "redirectUri": f"http://127.0.0.1:{redirect_port}/callback",
        }
    else:
        client = _resolve_or_register_client(base, redirect_port, tls_insecure=tls_insecure)

    # 2. GET sign-in page (with cookie jar)
    cookies = httpx.Cookies()
    with httpx.Client(
        cookies=cookies, verify=not tls_insecure, follow_redirects=False, timeout=30.0
    ) as cx:
        signin_url = _follow_to_signin_page(cx, base)
        page_resp = cx.get(signin_url, headers={"Accept": "text/html"})
        page_resp.raise_for_status()
        page = parse_signin_page_html_props(page_resp.text)
        challenge = page.get("challenge") or _challenge_from_url(signin_url) or ""
        if not challenge:
            raise RuntimeError("Sign-in page did not expose login_challenge.")

        pem = _resolve_public_key_pem(signin_public_key_pem, page.get("rsa_public_key_material"))
        cipher = encrypt_pkcs1_v15(password, pem)

        body = _build_signin_post_body(
            csrftoken=page["csrftoken"],
            challenge=challenge,
            account=username,
            password_cipher=cipher,
            remember=bool(page.get("remember") or False),
        )

        # 3. POST /oauth2/signin
        post_resp = cx.post(
            f"{base}/oauth2/signin",
            json=body,
            headers={"Accept": "application/json, text/plain, */*"},
        )
        if post_resp.status_code == 401:
            try:
                err_json = post_resp.json()
            except Exception:
                err_json = {}
            if err_json.get("code") == 401001017:
                # 401001017 retry handled in Task 5; for now always raise.
                raise InitialPasswordChangeRequiredError(
                    account=username,
                    base_url=base,
                    server_message=str(err_json.get("message", "")),
                )
            raise RuntimeError(
                f"OAuth2 sign-in failed: 401 {post_resp.text[:500]}"
            )
        if post_resp.status_code not in (302, 303, 307, 308):
            raise RuntimeError(
                f"OAuth2 sign-in failed: {post_resp.status_code} {post_resp.text[:500]}"
            )

        # 4. Follow redirects until /callback?code=
        code = _follow_to_callback(cx, base, post_resp.headers["location"], client["redirectUri"])

    # 5. Exchange code → token
    token = _exchange_code(
        base,
        code=code,
        client_id=client["clientId"],
        client_secret=client["clientSecret"],
        redirect_uri=client["redirectUri"],
        tls_insecure=tls_insecure,
    )
    if tls_insecure:
        token["tlsInsecure"] = True

    # 6. Persist + activate
    store = PlatformStore()
    store.save_token(base, token)
    store.use(base)
    return token


def _follow_to_signin_page(cx: httpx.Client, base: str) -> str:
    url = f"{base}/api/dip-hub/v1/login"
    for _ in range(20):
        r = cx.get(url, headers={"Accept": "text/html"})
        if r.status_code in (302, 303, 307, 308):
            url = httpx.URL(r.headers["location"], base_url=httpx.URL(url)).human_repr()
            if "/oauth2/signin" in url:
                return url
            continue
        if r.status_code == 200 and "/oauth2/signin" in str(r.url):
            return str(r.url)
        raise RuntimeError(f"Failed to reach signin page from {base}: HTTP {r.status_code}")
    raise RuntimeError("Too many redirects en route to /oauth2/signin")


def _follow_to_callback(
    cx: httpx.Client, base: str, start_location: str, redirect_uri: str,
) -> str:
    callback = urlparse(redirect_uri)
    url = httpx.URL(start_location, base_url=httpx.URL(base)).human_repr()
    for _ in range(40):
        u = urlparse(url)
        if u.netloc == callback.netloc and u.path == callback.path:
            params = parse_qs(u.query)
            if "code" not in params:
                raise RuntimeError("Callback URL missing authorization code.")
            return params["code"][0]
        r = cx.get(url, headers={"Accept": "text/html"})
        if r.status_code in (302, 303, 307, 308):
            url = httpx.URL(r.headers["location"], base_url=httpx.URL(url)).human_repr()
            continue
        raise RuntimeError(f"Unexpected status {r.status_code} during signin redirect chain at {url[:120]}")
    raise RuntimeError("Too many OAuth redirects")


def _challenge_from_url(url: str) -> str | None:
    return parse_qs(urlparse(url).query).get("login_challenge", [None])[0]
```

Update `packages/python/src/kweaver/auth/__init__.py` — add:

```python
from kweaver.auth._http_signin import http_signin
```

Append `"http_signin",` to `__all__`.

- [ ] **Step 4: Run test to verify it passes**

```bash
$PYTEST tests/unit/auth/test_http_signin.py::test_http_signin_happy_path -v
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/auth/_http_signin.py \
        packages/python/src/kweaver/auth/__init__.py \
        packages/python/tests/unit/auth/test_http_signin.py
git commit -m "feat(auth): http_signin happy path (RSA password + redirect chain)"
```

---

## Task 5: `http_signin` — 401001017 + new_password auto-retry + cookie jar

**Files:**
- Modify: `packages/python/src/kweaver/auth/_http_signin.py`
- Modify: `packages/python/tests/unit/auth/test_http_signin.py` (add cases)

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/auth/test_http_signin.py`:

```python
@respx.mock
def test_http_signin_raises_initial_password_required(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(200, text="ok"))
    respx.get(f"{base}/api/dip-hub/v1/login").mock(
        return_value=httpx.Response(
            302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"}
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(401, json={"code": 401001017, "message": "must change"})
    )

    from kweaver.auth import InitialPasswordChangeRequiredError

    with pytest.raises(InitialPasswordChangeRequiredError) as ei:
        http_signin(base, username="alice", password="oldpwd")
    assert ei.value.account == "alice"
    assert ei.value.base_url == base


@respx.mock
def test_http_signin_with_new_password_auto_retries_once(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    redirect_uri = "http://127.0.0.1:9010/callback"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(200, text="ok"))
    respx.get(f"{base}/api/dip-hub/v1/login").mock(
        return_value=httpx.Response(
            302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"}
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/api/eacp/v1/auth1/modifypassword").mock(
        return_value=httpx.Response(200, json={"code": 0})
    )

    call_count = {"n": 0}

    def _signin_post(req: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(401, json={"code": 401001017, "message": "must change"})
        return httpx.Response(
            302, headers={"location": f"{redirect_uri}?code=AUTHCODE&state=STATE"}
        )

    respx.post(f"{base}/oauth2/signin").mock(side_effect=_signin_post)
    respx.post(f"{base}/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "AT", "refresh_token": "RT", "id_token": "IT",
                "token_type": "Bearer", "expires_in": 3600, "scope": "openid",
            },
        )
    )

    token = http_signin(base, username="alice", password="oldpwd", new_password="NewPwd1!")
    assert token["accessToken"] == "AT"
    assert call_count["n"] == 2  # original + 1 retry, no infinite loop


@respx.mock
def test_http_signin_does_not_retry_more_than_once(tmp_kweaver_home) -> None:
    """Even with new_password, _retry_count ceiling prevents infinite recursion."""
    base = "https://x.example.com"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "cid", "client_secret": "csec"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(200, text="ok"))
    respx.get(f"{base}/api/dip-hub/v1/login").mock(
        return_value=httpx.Response(
            302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"}
        )
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/api/eacp/v1/auth1/modifypassword").mock(
        return_value=httpx.Response(200, json={"code": 0})
    )
    # Always returns 401001017 — even after change-password.
    respx.post(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(401, json={"code": 401001017, "message": "still bad"})
    )

    from kweaver.auth import InitialPasswordChangeRequiredError

    with pytest.raises(InitialPasswordChangeRequiredError):
        http_signin(base, username="alice", password="oldpwd", new_password="NewPwd1!")
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
$PYTEST tests/unit/auth/test_http_signin.py -v
```
Expected: 2 of 3 new tests fail (`auto_retries_once` and `does_not_retry_more_than_once`).

- [ ] **Step 3: Add retry logic to `_http_signin.py`**

Replace the 401001017 branch in `http_signin` with:

```python
        if post_resp.status_code == 401:
            try:
                err_json = post_resp.json()
            except Exception:
                err_json = {}
            if err_json.get("code") == 401001017:
                if new_password and _retry_count < 1:
                    from kweaver.auth.eacp import eacp_modify_password
                    res = eacp_modify_password(
                        base,
                        account=username,
                        old_password=password,
                        new_password=new_password,
                        tls_insecure=tls_insecure,
                    )
                    if not res["ok"]:
                        raise RuntimeError(
                            f"Auto change-password failed: {res['status']} {res['body'][:300]}"
                        ) from InitialPasswordChangeRequiredError(
                            account=username, base_url=base,
                            server_message=str(err_json.get("message", "")),
                        )
                    return http_signin(
                        base_url,
                        username=username,
                        password=new_password,
                        client_id=client_id,
                        client_secret=client_secret,
                        new_password=None,  # don't retry again
                        signin_public_key_pem=signin_public_key_pem,
                        tls_insecure=tls_insecure,
                        lang=lang,
                        redirect_port=redirect_port,
                        _retry_count=_retry_count + 1,
                    )
                raise InitialPasswordChangeRequiredError(
                    account=username,
                    base_url=base,
                    server_message=str(err_json.get("message", "")),
                )
            raise RuntimeError(
                f"OAuth2 sign-in failed: 401 {post_resp.text[:500]}"
            )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
$PYTEST tests/unit/auth/test_http_signin.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/auth/_http_signin.py \
        packages/python/tests/unit/auth/test_http_signin.py
git commit -m "feat(auth): 401001017 + new_password auto-retry (one shot, no recursion)"
```

---

## Task 6: No-auth handling — `save_no_auth_platform` + 404 auto-fallback

**Files:**
- Modify: `packages/python/src/kweaver/auth/_http_signin.py`
- Create: `packages/python/src/kweaver/auth/store_helpers.py` (just for `save_no_auth_platform` + `is_no_auth` re-export this task)
- Modify: `packages/python/src/kweaver/auth/__init__.py`
- Create: `packages/python/tests/unit/auth/test_no_auth.py`

- [ ] **Step 1: Write failing tests**

`packages/python/tests/unit/auth/test_no_auth.py`:

```python
"""No-auth: explicit save + 404 auto-fallback during signin/oauth2/auth."""
from __future__ import annotations

import warnings

import httpx
import pytest
import respx

from kweaver.auth import (
    NO_AUTH_TOKEN,
    http_signin,
    is_no_auth,
    save_no_auth_platform,
)
from kweaver.config.store import PlatformStore


def test_save_no_auth_platform_writes_sentinel_and_activates(tmp_kweaver_home) -> None:
    token = save_no_auth_platform("https://x.example.com")
    assert token["accessToken"] == NO_AUTH_TOKEN
    assert is_no_auth(token["accessToken"])
    store = PlatformStore()
    assert store.get_active() == "https://x.example.com"


@respx.mock
def test_http_signin_falls_back_on_oauth2_clients_404(tmp_kweaver_home) -> None:
    base = "https://noauth.example.com"
    respx.post(f"{base}/oauth2/clients").mock(return_value=httpx.Response(404, text=""))

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        token = http_signin(base, username="alice", password="x")

    assert token["accessToken"] == NO_AUTH_TOKEN
    assert any("no-auth" in str(w.message).lower() for w in caught)


@respx.mock
def test_http_signin_falls_back_on_dip_login_404(tmp_kweaver_home) -> None:
    base = "https://noauth.example.com"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "c", "client_secret": "s"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(200, text="ok"))
    respx.get(f"{base}/api/dip-hub/v1/login").mock(return_value=httpx.Response(404, text=""))

    token = http_signin(base, username="alice", password="x")
    assert token["accessToken"] == NO_AUTH_TOKEN


@respx.mock
def test_http_signin_does_not_fall_back_on_500(tmp_kweaver_home) -> None:
    base = "https://server-error.example.com"
    respx.post(f"{base}/oauth2/clients").mock(return_value=httpx.Response(500, text="oops"))
    with pytest.raises(httpx.HTTPStatusError):
        http_signin(base, username="alice", password="x")
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
$PYTEST tests/unit/auth/test_no_auth.py -v
```
Expected: ImportError on `save_no_auth_platform` / `is_no_auth` / `NO_AUTH_TOKEN`.

- [ ] **Step 3: Implement no-auth helpers + fallback wiring**

`packages/python/src/kweaver/auth/store_helpers.py`:

```python
"""Thin SDK helpers over PlatformStore (will grow in Task 9)."""
from __future__ import annotations

from typing import Any

from kweaver.config.no_auth import NO_AUTH_TOKEN, is_no_auth
from kweaver.config.store import PlatformStore


def save_no_auth_platform(
    base_url: str, *, tls_insecure: bool = False
) -> dict[str, Any]:
    """Mark a platform as no-auth. Writes token.json with NO_AUTH_TOKEN sentinel.

    No network call. Used by:
      - kweaver.login(..., no_auth=True)        — explicit
      - http_signin / OAuth2BrowserAuth on 404  — auto-fallback (warning emitted)
    """
    store = PlatformStore()
    return store.save_no_auth_platform(base_url, tls_insecure=tls_insecure)


__all__ = ["NO_AUTH_TOKEN", "is_no_auth", "save_no_auth_platform"]
```

In `_http_signin.py`, modify `_resolve_or_register_client` and `_follow_to_signin_page` to detect 404 and bubble a sentinel; modify `http_signin` to catch and call `save_no_auth_platform`. Concretely:

1. Define a private exception:

```python
class _NoAuthFallback(Exception):
    """Internal sentinel: caught by http_signin → save_no_auth_platform + warning."""
```

2. In `_resolve_or_register_client`, after `resp = httpx.post(.../oauth2/clients...)`, before `raise_for_status`:

```python
    if resp.status_code == 404:
        raise _NoAuthFallback()
    resp.raise_for_status()
```

3. In `_follow_to_signin_page`, when GET hits 404:

```python
        if r.status_code == 404:
            raise _NoAuthFallback()
```

4. Wrap the body of `http_signin` in `try/except _NoAuthFallback`:

```python
    import warnings
    try:
        # ...existing happy path...
    except _NoAuthFallback:
        warnings.warn(
            "OAuth2 endpoint not found (404). Saving platform in no-auth mode.",
            RuntimeWarning,
            stacklevel=2,
        )
        from kweaver.auth.store_helpers import save_no_auth_platform
        return save_no_auth_platform(base, tls_insecure=tls_insecure)
```

Update `auth/__init__.py`:

```python
from kweaver.auth.store_helpers import (
    NO_AUTH_TOKEN,
    is_no_auth,
    save_no_auth_platform,
)
```

Append the 3 names to `__all__`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
$PYTEST tests/unit/auth/test_no_auth.py tests/unit/auth/test_http_signin.py -v
```
Expected: 4 (no_auth) + 4 (http_signin) = 8 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/auth/_http_signin.py \
        packages/python/src/kweaver/auth/store_helpers.py \
        packages/python/src/kweaver/auth/__init__.py \
        packages/python/tests/unit/auth/test_no_auth.py
git commit -m "feat(auth): no-auth save + 404 auto-fallback (matches TS behavior)"
```

---

## Task 7: `HttpSigninAuth` provider in `_auth.py`

**Files:**
- Modify: `packages/python/src/kweaver/_auth.py`
- Create: `packages/python/tests/unit/auth/test_http_signin_auth_provider.py`

- [ ] **Step 1: Write failing tests**

`packages/python/tests/unit/auth/test_http_signin_auth_provider.py`:

```python
"""HttpSigninAuth: AuthProvider that calls http_signin on demand + caches token."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from kweaver._auth import HttpSigninAuth
from kweaver.auth import NO_AUTH_TOKEN
from kweaver.config.store import PlatformStore


def _signin_html(csrf: str, challenge: str) -> str:
    return (
        '<script id="__NEXT_DATA__" type="application/json">'
        + json.dumps({"props": {"pageProps": {"challenge": challenge, "csrftoken": csrf}}})
        + "</script>"
    )


def test_http_signin_auth_returns_empty_for_no_auth_token(tmp_kweaver_home) -> None:
    PlatformStore().save_no_auth_platform("https://x.example.com")
    auth = HttpSigninAuth("https://x.example.com", username="alice", password="x")
    assert auth.auth_headers() == {}


@respx.mock
def test_http_signin_auth_lazy_login_on_first_use(tmp_kweaver_home) -> None:
    base = "https://x.example.com"
    redirect = "http://127.0.0.1:9010/callback"
    respx.post(f"{base}/oauth2/clients").mock(
        return_value=httpx.Response(201, json={"client_id": "c", "client_secret": "s"})
    )
    respx.get(f"{base}/oauth2/auth").mock(return_value=httpx.Response(200, text="ok"))
    respx.get(f"{base}/api/dip-hub/v1/login").mock(
        return_value=httpx.Response(302, headers={"location": f"{base}/oauth2/signin?login_challenge=c"})
    )
    respx.get(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(200, text=_signin_html("csrf", "c"))
    )
    respx.post(f"{base}/oauth2/signin").mock(
        return_value=httpx.Response(302, headers={"location": f"{redirect}?code=AC&state=S"})
    )
    respx.post(f"{base}/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "AT", "refresh_token": "RT", "id_token": "IT",
                  "token_type": "Bearer", "expires_in": 3600, "scope": "openid"},
        )
    )

    auth = HttpSigninAuth(base, username="alice", password="hunter2")
    headers = auth.auth_headers()
    assert headers == {"Authorization": "Bearer AT"}
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
$PYTEST tests/unit/auth/test_http_signin_auth_provider.py -v
```
Expected: ImportError on `HttpSigninAuth`.

- [ ] **Step 3: Add `HttpSigninAuth` to `_auth.py`**

In `packages/python/src/kweaver/_auth.py`, after the `OAuth2BrowserAuth` class, add:

```python
class HttpSigninAuth:
    """AuthProvider using HTTP /oauth2/signin (no browser, no Playwright).

    Lazy: calls http_signin on first auth_headers() call, then reads/refreshes
    via the same store as OAuth2BrowserAuth/ConfigAuth.
    """

    def __init__(
        self,
        base_url: str,
        *,
        username: str,
        password: str,
        new_password: str | None = None,
        signin_public_key_pem: str | None = None,
        tls_insecure: bool = False,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._username = username
        self._password = password
        self._new_password = new_password
        self._signin_public_key_pem = signin_public_key_pem
        self._tls_insecure = tls_insecure
        self._lock = threading.Lock()

    def auth_headers(self) -> dict[str, str]:
        from kweaver.auth import http_signin
        from kweaver.config.no_auth import is_no_auth

        with self._lock:
            store = PlatformStore_lazy = None  # avoid circular at import time
            from kweaver.config.store import PlatformStore
            store = PlatformStore()
            token_data = store.load_token(self._base_url)
            need_login = (
                not token_data
                or not token_data.get("accessToken")
                or _token_expired(token_data)
            )
            if need_login:
                token_data = http_signin(
                    self._base_url,
                    username=self._username,
                    password=self._password,
                    new_password=self._new_password,
                    signin_public_key_pem=self._signin_public_key_pem,
                    tls_insecure=self._tls_insecure,
                )
            access = token_data.get("accessToken", "")
            if is_no_auth(access):
                return {}
            return {"Authorization": f"Bearer {access}"}

    def __repr__(self) -> str:
        return f"HttpSigninAuth(base_url={self._base_url!r}, username={self._username!r})"


def _token_expired(token_data: dict) -> bool:
    expires_at = token_data.get("expiresAt")
    if not expires_at:
        return False
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        return (dt - datetime.now(timezone.utc)).total_seconds() < 60
    except (ValueError, TypeError):
        return False
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
$PYTEST tests/unit/auth/test_http_signin_auth_provider.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_auth.py \
        packages/python/tests/unit/auth/test_http_signin_auth_provider.py
git commit -m "feat(auth): HttpSigninAuth AuthProvider (lazy, no-auth aware)"
```

---

## Task 8: `OAuth2BrowserAuth.login_with_refresh_token` + 404 fallback

**Files:**
- Modify: `packages/python/src/kweaver/_auth.py`
- Modify: `packages/python/tests/unit/test_auth.py` (add cases)

- [ ] **Step 1: Write failing tests**

Append to `packages/python/tests/unit/test_auth.py`:

```python
import warnings

import httpx
import respx

from kweaver._auth import OAuth2BrowserAuth
from kweaver.auth import NO_AUTH_TOKEN


@respx.mock
def test_login_with_refresh_token_writes_credentials(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    base = "https://example.com"
    respx.post(f"{base}/oauth2/token").mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "NEW_AT", "refresh_token": "NEW_RT", "id_token": "NEW_IT",
                  "token_type": "Bearer", "expires_in": 3600, "scope": "openid"},
        )
    )

    auth = OAuth2BrowserAuth(base)
    auth.login_with_refresh_token(
        client_id="cid", client_secret="csec", refresh_token="OLD_RT"
    )
    headers = auth.auth_headers()
    assert headers == {"Authorization": "Bearer NEW_AT"}


@respx.mock
def test_browser_login_404_falls_back_to_no_auth(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    base = "https://noauth.example.com"
    respx.post(f"{base}/oauth2/clients").mock(return_value=httpx.Response(404, text=""))

    auth = OAuth2BrowserAuth(base)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        auth.login()  # no browser is opened — fallback short-circuits

    headers = auth.auth_headers()
    assert headers == {}
    assert any("no-auth" in str(w.message).lower() for w in caught)
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
$PYTEST tests/unit/test_auth.py::test_login_with_refresh_token_writes_credentials tests/unit/test_auth.py::test_browser_login_404_falls_back_to_no_auth -v
```
Expected: AttributeError (no `login_with_refresh_token`) and 404 not handled.

- [ ] **Step 3: Implement both**

In `packages/python/src/kweaver/_auth.py`, add inside `OAuth2BrowserAuth`:

```python
    def login_with_refresh_token(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
    ) -> None:
        """Headless first-time login: exchange a known refresh_token for tokens.

        Saves both client.json (so future refreshes work) and token.json.
        """
        client = {
            "baseUrl": self._base_url,
            "clientId": client_id,
            "clientSecret": client_secret,
            "redirectUri": self._resolve_redirect_uri(),
            "scope": self._scope,
            "lang": self._lang,
            "product": "adp",
        }
        seed_token = {"refreshToken": refresh_token, "tlsInsecure": self._tls_insecure}
        self._refresh_token(seed_token, client)
        self._store.save_client(self._base_url, client)
        self._store.use(self._base_url)
```

Modify `_resolve_or_register_client` (already exists in `_auth.py`) to detect 404 from `_register_client` and short-circuit:

```python
    def _resolve_or_register_client(self) -> dict:
        # ... existing logic ...
        try:
            client_data = self._register_client()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise _NoAuthFallback() from exc
            raise
        # ... rest unchanged ...
```

Modify `OAuth2BrowserAuth.login` to wrap with try/except `_NoAuthFallback`:

```python
    def login(self, *, no_browser: bool = False) -> None:
        import warnings
        try:
            # ... existing body ...
        except _NoAuthFallback:
            warnings.warn(
                "OAuth2 endpoint not found (404). Saving platform in no-auth mode.",
                RuntimeWarning,
                stacklevel=2,
            )
            self._store.save_no_auth_platform(self._base_url, tls_insecure=self._tls_insecure)
            self._store.use(self._base_url)
```

Define `_NoAuthFallback` once at module top of `_auth.py`:

```python
class _NoAuthFallback(Exception):
    """Internal sentinel for 404 → no-auth conversion."""
```

Modify `OAuth2BrowserAuth.auth_headers` to also detect no-auth tokens (likely already there via `is_no_auth` import).

- [ ] **Step 4: Run tests to verify they pass**

```bash
$PYTEST tests/unit/test_auth.py -v
```
Expected: all `test_auth.py` cases pass (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/_auth.py \
        packages/python/tests/unit/test_auth.py
git commit -m "feat(auth): OAuth2BrowserAuth.login_with_refresh_token + 404 fallback"
```

---

## Task 9: `store_helpers` — whoami / list_platforms / list_users / set_active_user / export_credentials

**Files:**
- Modify: `packages/python/src/kweaver/auth/store_helpers.py`
- Modify: `packages/python/src/kweaver/auth/__init__.py`
- Create: `packages/python/tests/unit/auth/test_store_helpers.py`

- [ ] **Step 1: Write failing tests**

`packages/python/tests/unit/auth/test_store_helpers.py`:

```python
"""Tests for whoami / list_platforms / list_users / set_active_user / export_credentials."""
from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx

from kweaver.auth import (
    export_credentials,
    get_active_user,
    list_platforms,
    list_users,
    set_active_user,
    whoami,
)
from kweaver.config.store import PlatformStore


def _id_token(sub: str, account: str = "alice") -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": sub, "account": account}).encode()
    ).decode().rstrip("=")
    return f"hdr.{payload}.sig"


def test_list_platforms_empty(tmp_kweaver_home) -> None:
    assert list_platforms() == []


def test_list_platforms_after_save(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token("https://a.example.com", {"accessToken": "AT", "idToken": _id_token("u1")})
    store.save_token("https://b.example.com", {"accessToken": "AT2", "idToken": _id_token("u2")})
    store.use("https://b.example.com")
    plats = list_platforms()
    urls = {p["base_url"] for p in plats}
    assert urls == {"https://a.example.com", "https://b.example.com"}
    active = [p for p in plats if p["active"]]
    assert len(active) == 1 and active[0]["base_url"] == "https://b.example.com"


def test_list_users_returns_users_for_platform(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token("https://a.example.com", {"accessToken": "AT", "idToken": _id_token("u1", "alice")})
    store.save_token("https://a.example.com", {"accessToken": "AT2", "idToken": _id_token("u2", "bob")})
    users = list_users("https://a.example.com")
    ids = {u["id"] for u in users}
    assert ids == {"u1", "u2"}


def test_set_active_user_switches(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token("https://a.example.com", {"accessToken": "AT", "idToken": _id_token("u1")})
    store.save_token("https://a.example.com", {"accessToken": "AT2", "idToken": _id_token("u2")})
    set_active_user("https://a.example.com", "u1")
    assert get_active_user("https://a.example.com") == "u1"
    set_active_user("https://a.example.com", "u2")
    assert get_active_user("https://a.example.com") == "u2"


@respx.mock
def test_whoami_combines_id_token_and_eacp(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_token(
        "https://a.example.com",
        {"accessToken": "AT", "idToken": _id_token("u1", "alice")},
    )
    store.use("https://a.example.com")
    respx.get("https://a.example.com/api/eacp/v1/user/get").mock(
        return_value=httpx.Response(200, json={"id": "u1", "name": "Alice", "type": "user", "tenant": "T"})
    )
    info = whoami("https://a.example.com")
    assert info["sub"] == "u1"
    assert info["account"] == "alice"
    assert info["name"] == "Alice"
    assert info["type"] == "user"


def test_export_credentials_returns_dict(tmp_kweaver_home) -> None:
    store = PlatformStore()
    store.save_client("https://a.example.com", {"clientId": "cid", "clientSecret": "csec"})
    store.save_token(
        "https://a.example.com",
        {"accessToken": "AT", "refreshToken": "RT", "idToken": _id_token("u1")},
    )
    creds = export_credentials("https://a.example.com")
    assert creds["base_url"] == "https://a.example.com"
    assert creds["client_id"] == "cid"
    assert creds["client_secret"] == "csec"
    assert creds["refresh_token"] == "RT"
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
$PYTEST tests/unit/auth/test_store_helpers.py -v
```
Expected: ImportError on `whoami` / `list_platforms` / etc.

- [ ] **Step 3: Expand `store_helpers.py`**

Replace the previous tiny `store_helpers.py` with the full version:

```python
"""SDK helpers over PlatformStore (whoami / list / users / export / no-auth)."""
from __future__ import annotations

from typing import Any, TypedDict

from kweaver.config.no_auth import NO_AUTH_TOKEN, is_no_auth
from kweaver.config.store import PlatformStore
from kweaver.auth.eacp import fetch_eacp_user_info


class PlatformInfoDict(TypedDict):
    base_url: str
    alias: str | None
    active: bool
    user_count: int


class UserProfile(TypedDict):
    id: str
    display_name: str | None
    active: bool


class WhoamiInfo(TypedDict, total=False):
    sub: str | None
    account: str | None
    name: str | None
    type: str | None
    tenant: str | None
    base_url: str


class ExportedCredentials(TypedDict):
    base_url: str
    client_id: str
    client_secret: str
    refresh_token: str
    tls_insecure: bool


def save_no_auth_platform(
    base_url: str, *, tls_insecure: bool = False
) -> dict[str, Any]:
    return PlatformStore().save_no_auth_platform(base_url, tls_insecure=tls_insecure)


def list_platforms() -> list[PlatformInfoDict]:
    store = PlatformStore()
    active = store.get_active()
    out: list[PlatformInfoDict] = []
    for p in store.list_platforms():
        out.append(
            PlatformInfoDict(
                base_url=p.url,
                alias=getattr(p, "alias", None),
                active=(p.url == active),
                user_count=len(store.list_users(p.url)),
            )
        )
    return out


def list_users(base_url: str) -> list[UserProfile]:
    store = PlatformStore()
    active = store.get_active_user(base_url)
    profiles = store.list_user_profiles(base_url)
    return [
        UserProfile(
            id=p["id"],
            display_name=p.get("displayName"),
            active=(p["id"] == active),
        )
        for p in profiles
    ]


def get_active_user(base_url: str) -> str | None:
    return PlatformStore().get_active_user(base_url)


def set_active_user(base_url: str, identifier: str) -> None:
    """Identifier may be a user id or username; resolves via PlatformStore."""
    store = PlatformStore()
    user_id = store.resolve_user_id(base_url, identifier)
    if not user_id:
        raise ValueError(f"User {identifier!r} not found for {base_url}")
    store.set_active_user(base_url, user_id)


def whoami(base_url: str | None = None) -> WhoamiInfo:
    """Decode id_token sub/account + (best-effort) merge EACP userinfo."""
    import base64
    import json

    store = PlatformStore()
    url = base_url or store.get_active()
    if not url:
        raise RuntimeError("No active platform. Pass base_url= or call kweaver.login first.")
    token = store.load_token(url)
    if not token:
        raise RuntimeError(f"No token for {url}.")
    info: WhoamiInfo = {"base_url": url, "sub": None, "account": None, "name": None, "type": None}
    id_token = token.get("idToken") or ""
    if id_token:
        try:
            payload = id_token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            data = json.loads(base64.urlsafe_b64decode(payload))
            info["sub"] = data.get("sub")
            info["account"] = data.get("account") or data.get("preferred_username")
            info["name"] = data.get("name")
        except Exception:
            pass
    access = token.get("accessToken", "")
    if access and not is_no_auth(access):
        eacp = fetch_eacp_user_info(url, access_token=access, tls_insecure=bool(token.get("tlsInsecure")))
        if eacp:
            info["name"] = eacp.get("name") or info.get("name")
            info["type"] = eacp.get("type") or info.get("type")
            info["tenant"] = eacp.get("tenant")
    return info


def export_credentials(base_url: str | None = None) -> ExportedCredentials:
    store = PlatformStore()
    url = base_url or store.get_active()
    if not url:
        raise RuntimeError("No active platform.")
    client = store.load_client(url)
    token = store.load_token(url)
    return ExportedCredentials(
        base_url=url,
        client_id=client.get("clientId", ""),
        client_secret=client.get("clientSecret", ""),
        refresh_token=token.get("refreshToken", ""),
        tls_insecure=bool(token.get("tlsInsecure")),
    )


__all__ = [
    "NO_AUTH_TOKEN",
    "is_no_auth",
    "save_no_auth_platform",
    "list_platforms",
    "list_users",
    "get_active_user",
    "set_active_user",
    "whoami",
    "export_credentials",
    "PlatformInfoDict",
    "UserProfile",
    "WhoamiInfo",
    "ExportedCredentials",
]
```

Update `auth/__init__.py` to re-export the new helpers (`whoami`, `list_platforms`, `list_users`, `get_active_user`, `set_active_user`, `export_credentials`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
$PYTEST tests/unit/auth/test_store_helpers.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/auth/store_helpers.py \
        packages/python/src/kweaver/auth/__init__.py \
        packages/python/tests/unit/auth/test_store_helpers.py
git commit -m "feat(auth): whoami/list_platforms/list_users/set_active_user/export_credentials"
```

---

## Task 10: Top-level `kweaver.login(...)` convenience

**Files:**
- Modify: `packages/python/src/kweaver/__init__.py`
- Create: `packages/python/tests/unit/auth/test_login_top_level.py`

- [ ] **Step 1: Write failing tests**

`packages/python/tests/unit/auth/test_login_top_level.py`:

```python
"""Tests for top-level kweaver.login() strategy dispatch."""
from __future__ import annotations

from unittest.mock import patch

import pytest

import kweaver


def test_login_no_auth_writes_sentinel(tmp_kweaver_home) -> None:
    token = kweaver.login("https://x.example.com", no_auth=True)
    from kweaver.auth import NO_AUTH_TOKEN
    assert token["accessToken"] == NO_AUTH_TOKEN


def test_login_no_auth_with_username_raises(tmp_kweaver_home) -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        kweaver.login("https://x", no_auth=True, username="alice", password="x")


def test_login_username_password_dispatches_to_http_signin(tmp_kweaver_home) -> None:
    with patch("kweaver.auth.http_signin") as m:
        m.return_value = {"accessToken": "AT"}
        kweaver.login("https://x", username="alice", password="pwd")
        m.assert_called_once()
        args, kwargs = m.call_args
        assert args[0] == "https://x"
        assert kwargs["username"] == "alice"
        assert kwargs["password"] == "pwd"


def test_login_refresh_token_dispatches_to_login_with_refresh_token(tmp_kweaver_home) -> None:
    with patch("kweaver._auth.OAuth2BrowserAuth.login_with_refresh_token") as m:
        kweaver.login(
            "https://x", client_id="cid", client_secret="csec", refresh_token="RT"
        )
        m.assert_called_once_with(client_id="cid", client_secret="csec", refresh_token="RT")


def test_login_default_dispatches_to_browser_login(tmp_kweaver_home) -> None:
    with patch("kweaver._auth.OAuth2BrowserAuth.login") as m:
        kweaver.login("https://x")
        m.assert_called_once_with(no_browser=False)


def test_login_no_browser_paste_flow(tmp_kweaver_home) -> None:
    with patch("kweaver._auth.OAuth2BrowserAuth.login") as m:
        kweaver.login("https://x", open_browser=False)
        m.assert_called_once_with(no_browser=True)
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
$PYTEST tests/unit/auth/test_login_top_level.py -v
```
Expected: AttributeError on `kweaver.login`.

- [ ] **Step 3: Add `login` to `kweaver/__init__.py`**

After the existing `configure(...)` function in `packages/python/src/kweaver/__init__.py`:

```python
def login(
    base_url: str,
    *,
    username: str | None = None,
    password: str | None = None,
    refresh_token: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    new_password: str | None = None,
    no_auth: bool = False,
    tls_insecure: bool = False,
    open_browser: bool = True,
) -> dict:
    """One-call login. Strategy is picked from arguments. See spec for full table."""
    if no_auth:
        if username or password or refresh_token:
            raise ValueError(
                "no_auth=True is mutually exclusive with username/password/refresh_token"
            )
        from kweaver.auth import save_no_auth_platform
        return save_no_auth_platform(base_url, tls_insecure=tls_insecure)

    if refresh_token:
        if not (client_id and client_secret):
            raise ValueError(
                "refresh_token requires client_id and client_secret"
            )
        from kweaver._auth import OAuth2BrowserAuth
        auth = OAuth2BrowserAuth(base_url, tls_insecure=tls_insecure)
        auth.login_with_refresh_token(
            client_id=client_id, client_secret=client_secret, refresh_token=refresh_token
        )
        from kweaver.config.store import PlatformStore
        return PlatformStore().load_token(base_url)

    if username and password:
        from kweaver.auth import http_signin
        return http_signin(
            base_url,
            username=username,
            password=password,
            client_id=client_id,
            client_secret=client_secret,
            new_password=new_password,
            tls_insecure=tls_insecure,
        )

    if username or password:
        raise ValueError("username and password must be provided together")

    from kweaver._auth import OAuth2BrowserAuth
    auth = OAuth2BrowserAuth(base_url, tls_insecure=tls_insecure)
    auth.login(no_browser=not open_browser)
    from kweaver.config.store import PlatformStore
    return PlatformStore().load_token(base_url)
```

Add `"login"` to `__all__`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
$PYTEST tests/unit/auth/ -v
```
Expected: full auth/ subdir green.

- [ ] **Step 5: Commit**

```bash
git add packages/python/src/kweaver/__init__.py \
        packages/python/tests/unit/auth/test_login_top_level.py
git commit -m "feat(auth): top-level kweaver.login() dispatch (5 strategies + no_auth)"
```

---

## Task 11: TS↔Python parity fixture test

**Files:**
- Create: `packages/typescript/test/dump-signin-fixtures.ts` (run-once script)
- Create: `packages/python/tests/fixtures/signin_post_body_basic.json`
- Create: `packages/python/tests/fixtures/spki_default_modulus.pem`
- Create: `packages/python/tests/unit/auth/test_ts_parity.py`

- [ ] **Step 1: Generate TS fixtures**

`packages/typescript/test/dump-signin-fixtures.ts`:

```typescript
import { writeFileSync } from "node:fs";
import {
  buildOauth2SigninPostBody,
  rsaModulusHexToSpkiPem,
  DEFAULT_SIGNIN_RSA_MODULUS_HEX,
} from "../src/auth/oauth.js";

const body = buildOauth2SigninPostBody({
  csrftoken: "CSRF_FIXTURE",
  challenge: "CHALLENGE_FIXTURE",
  account: "alice",
  passwordCipher: "CIPHER_FIXTURE",
  remember: false,
});
writeFileSync(
  "packages/python/tests/fixtures/signin_post_body_basic.json",
  JSON.stringify(body, null, 2) + "\n",
);

writeFileSync(
  "packages/python/tests/fixtures/spki_default_modulus.pem",
  rsaModulusHexToSpkiPem(DEFAULT_SIGNIN_RSA_MODULUS_HEX),
);

console.log("fixtures written.");
```

Run once:

```bash
cd packages/typescript && npx tsx test/dump-signin-fixtures.ts
```

Expected output: `fixtures written.` and the two fixture files appear in `packages/python/tests/fixtures/`.

- [ ] **Step 2: Write parity test**

`packages/python/tests/unit/auth/test_ts_parity.py`:

```python
"""TS↔Python byte-equality fixtures.

Fixtures are produced by packages/typescript/test/dump-signin-fixtures.ts.
Re-run that script when bumping signin/RSA logic in TS or Python.
"""
from __future__ import annotations

import json
from pathlib import Path

from kweaver.auth._crypto import (
    DEFAULT_SIGNIN_RSA_MODULUS_HEX,
    rsa_modulus_hex_to_spki_pem,
)
from kweaver.auth._http_signin import _build_signin_post_body

FIX = Path(__file__).resolve().parent.parent.parent / "fixtures"


def test_signin_post_body_byte_equal_with_ts() -> None:
    expected = json.loads((FIX / "signin_post_body_basic.json").read_text())
    actual = _build_signin_post_body(
        csrftoken="CSRF_FIXTURE",
        challenge="CHALLENGE_FIXTURE",
        account="alice",
        password_cipher="CIPHER_FIXTURE",
        remember=False,
    )
    assert actual == expected


def test_default_modulus_pem_byte_equal_with_ts() -> None:
    expected = (FIX / "spki_default_modulus.pem").read_text()
    actual = rsa_modulus_hex_to_spki_pem(DEFAULT_SIGNIN_RSA_MODULUS_HEX)
    # TS writes with trailing newline; normalize
    assert actual.strip() == expected.strip()
```

- [ ] **Step 3: Run test to verify it passes**

```bash
$PYTEST tests/unit/auth/test_ts_parity.py -v
```
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/test/dump-signin-fixtures.ts \
        packages/python/tests/fixtures/ \
        packages/python/tests/unit/auth/test_ts_parity.py
git commit -m "test(auth): TS↔Python byte-equality fixtures (signin body + SPKI PEM)"
```

---

## Task 12: Cleanup — delete `cli/`, `PasswordAuth`, `playwright`

**Files:**
- Delete: `packages/python/src/kweaver/cli/` (whole directory)
- Modify: `packages/python/src/kweaver/_auth.py` (remove `PasswordAuth`)
- Modify: `packages/python/src/kweaver/__init__.py` (remove `PasswordAuth` import + from `__all__`; update `configure(username=, password=)` to use `HttpSigninAuth` instead)
- Modify: `packages/python/tests/unit/test_auth.py` (remove `PasswordAuth` cases)
- Modify: `packages/python/pyproject.toml` (already removed playwright in Task 0; verify)

- [ ] **Step 1: Identify usages**

```bash
cd packages/python && grep -rn "PasswordAuth\|kweaver.cli\|playwright" src/ tests/
```

Record every hit; expect: `_auth.py` (definition), `__init__.py` (import + configure), `tests/unit/test_auth.py` (PasswordAuth tests), `cli/` (whole dir).

- [ ] **Step 2: Delete `kweaver.cli` package**

```bash
rm -rf packages/python/src/kweaver/cli
```

- [ ] **Step 3: Remove `PasswordAuth` from `_auth.py`**

Delete the entire `class PasswordAuth:` block (~60 lines) from `packages/python/src/kweaver/_auth.py`.

- [ ] **Step 4: Update `__init__.py`**

In `packages/python/src/kweaver/__init__.py`:

1. Remove `PasswordAuth` from the import line.
2. Remove `"PasswordAuth"` from `__all__`.
3. In `configure(...)`, replace the `username and password` branch:

```python
        elif username and password:
            effective_url = url or os.environ.get("KWEAVER_BASE_URL")
            if not effective_url:
                raise ValueError("Provide url=, config=True, or set KWEAVER_BASE_URL")
            from kweaver._auth import HttpSigninAuth
            auth_provider = HttpSigninAuth(
                base_url=effective_url, username=username, password=password
            )
            _default_client = KWeaverClient(
                base_url=effective_url, auth=auth_provider, business_domain=effective_domain
            )
```

- [ ] **Step 5: Remove PasswordAuth tests**

In `packages/python/tests/unit/test_auth.py`, delete every test referencing `PasswordAuth`. The auth provider list test (if any) should now include `HttpSigninAuth` instead.

Find them with:

```bash
cd packages/python && grep -n "PasswordAuth" tests/unit/test_auth.py
```

Delete each test function or rewrite to use `HttpSigninAuth` if the assertion is generic (e.g., "all providers implement auth_headers").

- [ ] **Step 6: Verify install + tests**

```bash
$PIP install -e 'packages/python[dev]'
pytest tests -v
```
Expected: all tests green; `playwright` not installed; `kweaver.cli` import fails.

- [ ] **Step 7: Commit**

```bash
git add -A packages/python
git commit -m "refactor(py): drop PasswordAuth + kweaver.cli (replaced by HttpSigninAuth + SDK API)"
```

---

## Task 13: README updates + version bump 0.6.8 → 0.7.0

**Files:**
- Modify: `packages/python/pyproject.toml`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `packages/python/README.md` (if exists)

- [ ] **Step 1: Bump version**

In `packages/python/pyproject.toml`: `version = "0.6.8"` → `version = "0.7.0"`.

- [ ] **Step 2: Add a "Pure Python auth" section to root README.md**

Insert under the existing "Python SDK" section:

````markdown
### Pure Python auth (no Node, no browser)

```python
import kweaver

# Username + password (HTTP /oauth2/signin + RSA, no browser, no Playwright)
kweaver.login("https://dip.example.com", username="alice", password="pwd")

# No-auth platform
kweaver.login("https://internal.example.com", no_auth=True)

# Headless machine — paste a refresh_token from another box
kweaver.login(
    "https://dip.example.com",
    client_id="cid", client_secret="csec", refresh_token="RT",
)

client = kweaver.KWeaver()        # reads ~/.kweaver/, auto-refresh
client.knowledge_networks.list()
```

See `kweaver.auth` for low-level helpers (`http_signin`, `eacp_modify_password`,
`whoami`, `list_platforms`, `set_active_user`, `export_credentials`,
`HttpSigninAuth` provider).

> **Breaking in 0.7.0:** `kweaver.PasswordAuth` (Playwright-based) was removed.
> Use `kweaver.HttpSigninAuth` or `kweaver.login(..., username=, password=)`
> instead — both faster and dependency-free.
````

Mirror in `README.zh.md` with a Chinese translation.

- [ ] **Step 3: Verify**

```bash
$PY -c "
import kweaver
import kweaver.auth as a
print(kweaver.login.__doc__[:80])
print(sorted(a.__all__))
"
```
Expected: docstring snippet + the full sorted public name list including
`HttpSigninAuth`, `http_signin`, `whoami`, `save_no_auth_platform`, etc.

- [ ] **Step 4: Run full test suite**

```bash
$PYTEST -v --cov=src/kweaver --cov-report=term-missing
```
Expected: all green, coverage ≥ 65% (matches `pyproject.toml fail_under`).

- [ ] **Step 5: Commit**

```bash
git add packages/python/pyproject.toml README.md README.zh.md packages/python/README.md 2>/dev/null
git commit -m "release(py): 0.7.0 — pure Python auth parity, drop Playwright"
```

---

## Self-Review (run before declaring complete)

1. **Spec coverage** — every section of the spec has at least one task:
   - `_crypto` → Task 1
   - `_signin_html` → Task 2
   - `eacp` (modify-password + InitialPasswordChangeRequiredError + userinfo) → Task 3
   - `_http_signin` (happy path + 401001017 + new_password retry + 4-tier pubkey priority + cookie jar) → Tasks 4 + 5
   - `save_no_auth_platform` + 404 fallback → Task 6
   - `HttpSigninAuth` provider → Task 7
   - `OAuth2BrowserAuth.login_with_refresh_token` + browser 404 fallback → Task 8
   - `whoami / list_platforms / list_users / set_active_user / export_credentials` → Task 9
   - Top-level `kweaver.login(...)` → Task 10
   - TS↔Python byte-equality fixtures → Task 11
   - Delete `PasswordAuth` + `cli/` + `playwright` dep → Task 12
   - README + version bump → Task 13

2. **Acceptance criteria check:**
   - "No Node, no Chromium" container can run `kweaver.login(url, username=..., password=...)` → covered by Task 4 + 7 + 10 + 12.
   - `pip install kweaver-sdk[dev]` no chromium → Task 0 + 12.
   - Coverage ≥ 65% → enforced in Task 13 step 4.
   - TS↔Python byte-equal fixtures → Task 11.
   - 401001017 auto-retry → Task 5.
   - No-auth: explicit + auto-fallback + provider returns `{}` → Tasks 6 + 7 + 8 + 10.

3. **No placeholders:** every code step shows actual code; every command shows expected output. No "TBD".

4. **Type consistency:** `http_signin` signature is identical across tasks; `HttpSigninAuth.__init__` matches it; `kweaver.login` keyword args match the spec table.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-22-python-auth-parity.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
