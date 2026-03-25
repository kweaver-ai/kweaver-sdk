"""Authentication providers."""

from __future__ import annotations

import os
import threading
import time
from typing import Protocol

import httpx


def _env_tls_insecure() -> bool:
    """True when KWEAVER_TLS_INSECURE is 1 or true (dev / scripting only)."""
    return os.environ.get("KWEAVER_TLS_INSECURE", "") in ("1", "true")


class AuthProvider(Protocol):
    """Protocol for authentication header injection."""

    def auth_headers(self) -> dict[str, str]: ...


class TokenAuth:
    """Static bearer-token authentication."""

    def __init__(self, token: str) -> None:
        self._token = token

    def auth_headers(self) -> dict[str, str]:
        return {"Authorization": self._token}

    def __repr__(self) -> str:
        return "TokenAuth(token='***')"


class PasswordAuth:
    """Browser-based OAuth2 login with auto-refresh.

    Uses Playwright (headless) to automate the Ory OAuth2 login flow:
      1. GET {base_url}/api/dip-hub/v1/login → OAuth2 redirect → signin page
      2. Fill account/password → click login
      3. Extract dip.oauth2_token cookie after callback

    Token is cached and refreshed on demand when expired or on auth error.
    Requires: ``pip install playwright && playwright install chromium``
    """

    # Refresh every 4 minutes (Ory tokens expire in ~5 min)
    _REFRESH_INTERVAL = 240

    def __init__(self, base_url: str, username: str, password: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._username = username
        self._password = password
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = threading.Lock()

    def auth_headers(self) -> dict[str, str]:
        with self._lock:
            if self._token is None or time.time() >= self._expires_at:
                self._refresh()
            return {"Authorization": f"Bearer {self._token}"}

    def refresh(self) -> str:
        """Force a token refresh and return the new token."""
        with self._lock:
            return self._refresh()

    def _refresh(self) -> str:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()

            page.goto(
                f"{self._base_url}/api/dip-hub/v1/login",
                wait_until="networkidle",
                timeout=30000,
            )

            page.fill('input[name="account"]', self._username)
            page.fill('input[name="password"]', self._password)
            page.click("button.ant-btn-primary")

            token = None
            for _ in range(30):
                time.sleep(1)
                for cookie in context.cookies():
                    if cookie["name"] == "dip.oauth2_token":
                        token = cookie["value"]
                        break
                if token:
                    break

            browser.close()

        if not token:
            raise RuntimeError(
                "Failed to extract KWeaver token after browser login. "
                "Check username/password."
            )

        self._token = token
        self._expires_at = time.time() + self._REFRESH_INTERVAL
        return token

    def __repr__(self) -> str:
        return f"PasswordAuth(username={self._username!r})"


class OAuth2Auth:
    """OAuth2 client-credentials authentication with auto-refresh."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        token_endpoint: str,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._token_endpoint = token_endpoint
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = threading.Lock()

    def auth_headers(self) -> dict[str, str]:
        token = self._get_token()
        return {"Authorization": f"Bearer {token}"}

    def _get_token(self) -> str:
        with self._lock:
            if self._token and time.time() < self._expires_at - 30:
                return self._token
            return self._refresh()

    def _refresh(self) -> str:
        resp = httpx.post(
            self._token_endpoint,
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._expires_at = time.time() + data.get("expires_in", 3600)
        return self._token  # type: ignore[return-value]

    def __repr__(self) -> str:
        return f"OAuth2Auth(client_id={self._client_id!r}, token_endpoint={self._token_endpoint!r})"


class ConfigAuth:
    """Read credentials from ~/.kweaver/, auto-refresh with refresh_token.

    Compatible with kweaverc (TypeScript CLI) — shared credential storage.
    """

    _REFRESH_THRESHOLD = 60  # seconds before expiry to trigger refresh

    def __init__(self, platform: str | None = None) -> None:
        from kweaver.config.store import PlatformStore
        self._store = PlatformStore()
        self._platform = self._store.resolve(platform) if platform else None
        self._lock = threading.Lock()

    @property
    def base_url(self) -> str:
        """Return the platform base URL."""
        url = self._platform or self._store.get_active()
        if not url:
            raise RuntimeError("No active platform. Run 'kweaver auth login' first.")
        return url

    def auth_headers(self) -> dict[str, str]:
        with self._lock:
            url = self.base_url
            token_data = self._store.load_token(url)
            if not token_data:
                raise RuntimeError(
                    f"No token found for {url}. Run 'kweaver auth login' first."
                )

            # Check expiration
            expires_at = token_data.get("expiresAt")
            if expires_at:
                from datetime import datetime, timezone
                try:
                    exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    remaining = (exp_dt - datetime.now(timezone.utc)).total_seconds()
                    if remaining < self._REFRESH_THRESHOLD:
                        token_data = self._refresh(url, token_data)
                except (ValueError, TypeError):
                    pass  # Can't parse expiry, use token as-is

            access_token = token_data.get("accessToken", "")
            return {"Authorization": f"Bearer {access_token}"}

    def _refresh(self, url: str, token_data: dict) -> dict:
        """Refresh token using refresh_token grant."""
        refresh_token = token_data.get("refreshToken")
        if not refresh_token:
            raise RuntimeError(
                f"Token expired and no refresh_token available for {url}. "
                "Run 'kweaver auth login' again."
            )

        client_data = self._store.load_client(url)
        client_id = client_data.get("clientId", "")
        client_secret = client_data.get("clientSecret", "")

        import base64
        from datetime import datetime, timezone, timedelta
        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

        tls_skip = bool(token_data.get("tlsInsecure")) or _env_tls_insecure()
        verify = not tls_skip

        resp = httpx.post(
            f"{url}/oauth2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            verify=verify,
        )
        resp.raise_for_status()
        data = resp.json()

        now = datetime.now(timezone.utc)
        expires_in = data.get("expires_in", 3600)
        new_token: dict = {
            "baseUrl": url,
            "accessToken": data["access_token"],
            "tokenType": data.get("token_type", "Bearer"),
            "scope": data.get("scope", token_data.get("scope", "")),
            "expiresIn": expires_in,
            "expiresAt": (now + timedelta(seconds=expires_in)).isoformat(),
            "refreshToken": data.get("refresh_token", refresh_token),
            "idToken": data.get("id_token", token_data.get("idToken", "")),
            "obtainedAt": now.isoformat(),
        }
        if token_data.get("tlsInsecure"):
            new_token["tlsInsecure"] = True
        self._store.save_token(url, new_token)
        return new_token

    def __repr__(self) -> str:
        return f"ConfigAuth(platform={self._platform!r})"


class OAuth2BrowserAuth:
    """OAuth2 authorization code flow with local callback server.

    Behavior matches kweaverc auth — opens browser, receives callback,
    exchanges code for token, stores in ~/.kweaver/.
    """

    def __init__(
        self,
        base_url: str,
        *,
        redirect_port: int = 9010,
        scope: str = "openid offline all",
        lang: str = "zh-cn",
        tls_insecure: bool = False,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._redirect_port = redirect_port
        self._scope = scope
        self._lang = lang
        self._tls_insecure = tls_insecure
        self._lock = threading.Lock()

        from kweaver.config.store import PlatformStore
        self._store = PlatformStore()

    def login(self) -> None:
        """Run full OAuth2 browser login flow."""
        import secrets
        import webbrowser
        from http.server import HTTPServer, BaseHTTPRequestHandler
        from urllib.parse import urlencode, urlparse, parse_qs

        # Step 1: Ensure we have a registered client
        client_data = self._store.load_client(self._base_url)
        if not client_data.get("clientId"):
            client_data = self._register_client()
            self._store.save_client(self._base_url, client_data)

        client_id = client_data["clientId"]
        client_secret = client_data["clientSecret"]
        redirect_uri = client_data["redirectUri"]

        # Step 2: Generate state for CSRF protection
        state = secrets.token_hex(12)

        # Step 3: Build authorization URL
        auth_params = {
            "redirect_uri": redirect_uri,
            "x-forwarded-prefix": "",
            "client_id": client_id,
            "scope": self._scope,
            "response_type": "code",
            "state": state,
            "lang": self._lang,
            "product": "adp",
        }
        auth_url = f"{self._base_url}/oauth2/auth?{urlencode(auth_params)}"

        # Step 4: Start local callback server
        received = {}

        class CallbackHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urlparse(self.path)
                params = parse_qs(parsed.query)
                if parsed.path == "/callback":
                    received["code"] = params.get("code", [None])[0]
                    received["state"] = params.get("state", [None])[0]
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(b"<html><body><h2>Login successful. You can close this tab.</h2></body></html>")
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):
                pass  # Suppress server logs

        server = HTTPServer(("127.0.0.1", self._redirect_port), CallbackHandler)
        server.timeout = 120

        # Step 5: Open browser
        webbrowser.open(auth_url)

        # Step 6: Wait for callback
        while "code" not in received:
            server.handle_request()

        server.server_close()

        # Validate state
        if received.get("state") != state:
            raise RuntimeError("OAuth2 state mismatch — possible CSRF attack")

        code = received["code"]
        if not code:
            raise RuntimeError("No authorization code received")

        # Step 7: Exchange code for token
        self._exchange_code(code, client_id, client_secret, redirect_uri)

        # Set as active platform
        self._store.use(self._base_url)

    def _register_client(self) -> dict:
        """Register OAuth2 client with the platform."""
        redirect_uri = f"http://127.0.0.1:{self._redirect_port}/callback"
        logout_uri = f"http://127.0.0.1:{self._redirect_port}/successful-logout"

        verify = not self._tls_insecure
        resp = httpx.post(
            f"{self._base_url}/oauth2/clients",
            json={
                "client_name": "kweaver-sdk",
                "grant_types": ["authorization_code", "implicit", "refresh_token"],
                "response_types": ["token id_token", "code", "token"],
                "scope": "openid offline all",
                "redirect_uris": [redirect_uri],
                "post_logout_redirect_uris": [logout_uri],
                "metadata": {
                    "device": {
                        "name": "kweaver-sdk",
                        "client_type": "web",
                        "description": "KWeaver Python SDK",
                    }
                },
            },
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            verify=verify,
        )
        resp.raise_for_status()
        data = resp.json()

        return {
            "baseUrl": self._base_url,
            "clientId": data["client_id"],
            "clientSecret": data["client_secret"],
            "redirectUri": redirect_uri,
            "logoutRedirectUri": logout_uri,
            "scope": self._scope,
            "lang": self._lang,
            "product": "adp",
            "xForwardedPrefix": "",
        }

    def _exchange_code(self, code: str, client_id: str, client_secret: str, redirect_uri: str) -> None:
        """Exchange authorization code for tokens."""
        import base64
        from datetime import datetime, timezone, timedelta

        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

        verify = not self._tls_insecure
        resp = httpx.post(
            f"{self._base_url}/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            verify=verify,
        )
        resp.raise_for_status()
        data = resp.json()

        now = datetime.now(timezone.utc)
        expires_in = data.get("expires_in", 3600)
        token_data = {
            "baseUrl": self._base_url,
            "accessToken": data["access_token"],
            "tokenType": data.get("token_type", "Bearer"),
            "scope": data.get("scope", ""),
            "expiresIn": expires_in,
            "expiresAt": (now + timedelta(seconds=expires_in)).isoformat(),
            "refreshToken": data.get("refresh_token", ""),
            "idToken": data.get("id_token", ""),
            "obtainedAt": now.isoformat(),
        }
        if self._tls_insecure:
            token_data["tlsInsecure"] = True
        self._store.save_token(self._base_url, token_data)

    def auth_headers(self) -> dict[str, str]:
        with self._lock:
            token_data = self._store.load_token(self._base_url)
            if not token_data or not token_data.get("accessToken"):
                raise RuntimeError(
                    f"Not logged in to {self._base_url}. Call login() first."
                )

            # Check expiration and refresh if needed
            expires_at = token_data.get("expiresAt")
            if expires_at:
                from datetime import datetime, timezone
                try:
                    exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    remaining = (exp_dt - datetime.now(timezone.utc)).total_seconds()
                    if remaining < 60:
                        client_data = self._store.load_client(self._base_url)
                        refresh_token = token_data.get("refreshToken")
                        if refresh_token and client_data.get("clientId"):
                            self._refresh_token(token_data, client_data)
                            token_data = self._store.load_token(self._base_url)
                except (ValueError, TypeError):
                    pass

            return {"Authorization": f"Bearer {token_data['accessToken']}"}

    def _refresh_token(self, token_data: dict, client_data: dict) -> None:
        """Refresh token using refresh_token grant."""
        import base64
        from datetime import datetime, timezone, timedelta

        client_id = client_data["clientId"]
        client_secret = client_data["clientSecret"]
        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

        tls_skip = bool(token_data.get("tlsInsecure")) or self._tls_insecure or _env_tls_insecure()
        verify = not tls_skip

        resp = httpx.post(
            f"{self._base_url}/oauth2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": token_data["refreshToken"],
            },
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            verify=verify,
        )
        resp.raise_for_status()
        data = resp.json()

        now = datetime.now(timezone.utc)
        expires_in = data.get("expires_in", 3600)
        new_token: dict = {
            "baseUrl": self._base_url,
            "accessToken": data["access_token"],
            "tokenType": data.get("token_type", "Bearer"),
            "scope": data.get("scope", token_data.get("scope", "")),
            "expiresIn": expires_in,
            "expiresAt": (now + timedelta(seconds=expires_in)).isoformat(),
            "refreshToken": data.get("refresh_token", token_data.get("refreshToken", "")),
            "idToken": data.get("id_token", token_data.get("idToken", "")),
            "obtainedAt": now.isoformat(),
        }
        if token_data.get("tlsInsecure") or self._tls_insecure:
            new_token["tlsInsecure"] = True
        self._store.save_token(self._base_url, new_token)

    def logout(self) -> None:
        """Sign out and clear local credentials."""
        token_data = self._store.load_token(self._base_url)
        tls_skip = bool(token_data.get("tlsInsecure")) or self._tls_insecure or _env_tls_insecure()
        verify = not tls_skip
        if token_data:
            try:
                params = {"client_id": self._store.load_client(self._base_url).get("clientId", "")}
                id_token = token_data.get("idToken")
                if id_token:
                    params["id_token_hint"] = id_token
                httpx.get(f"{self._base_url}/oauth2/signout", params=params, verify=verify)
            except Exception:
                pass
        token_path = self._store._platform_dir(self._base_url) / "token.json"
        if token_path.exists():
            os.remove(token_path)

    def __repr__(self) -> str:
        return f"OAuth2BrowserAuth(base_url={self._base_url!r})"
