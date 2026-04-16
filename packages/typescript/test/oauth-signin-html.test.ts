/**
 * HTML parsing for HTTP /oauth2/signin (Next.js __NEXT_DATA__).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SIGNIN_RSA_MODULUS_HEX,
  parseSigninPageHtmlProps,
  rsaModulusHexToSpkiPem,
  STUDIO_SIGNIN_RSA_MODULUS_HEX,
} from "../src/auth/oauth.js";

test("parseSigninPageHtmlProps: csrftoken and challenge", () => {
  const html = `<!DOCTYPE html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { challenge: "ch1", csrftoken: "csrf1" } },
  })}</script>`;
  const o = parseSigninPageHtmlProps(html);
  assert.equal(o.challenge, "ch1");
  assert.equal(o.csrftoken, "csrf1");
  assert.equal(o.remember, undefined);
});

test("parseSigninPageHtmlProps: accepts _csrf instead of csrftoken", () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { challenge: "c", _csrf: "x" } },
  })}</script>`;
  const o = parseSigninPageHtmlProps(html);
  assert.equal(o.csrftoken, "x");
});

test("parseSigninPageHtmlProps: missing __NEXT_DATA__ throws", () => {
  assert.throws(() => parseSigninPageHtmlProps("<html></html>"), /__NEXT_DATA__/);
});

test("parseSigninPageHtmlProps: parses remember boolean from pageProps", () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { challenge: "c", csrftoken: "t", remember: true } },
  })}</script>`;
  const o = parseSigninPageHtmlProps(html);
  assert.equal(o.remember, true);
});

test("parseSigninPageHtmlProps: parses publicKey hex modulus from pageProps", () => {
  const mod = "aabb";
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { csrftoken: "t", publicKey: mod } },
  })}</script>`;
  const o = parseSigninPageHtmlProps(html);
  assert.equal(o.rsaPublicKeyMaterial, mod);
});

test("parseSigninPageHtmlProps: finds nested Base64 SPKI in pageProps", () => {
  const spki =
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4E+eiWRwffhRIPQYvlXUjf0b3HqCmosiCxbFCYI/gdfDBhrTUzbt3fL3o/gRQQBEPf69vhJMFH2ZMtaJM6ohE3yQef331liPVM0YvqMOgvoID+zDa1NIZFObSsjOKhvZtv9esO0REeiVEPKNc+Dp6il3x7TV9VKGEv0+iriNjqv7TGAexo2jVtLm50iVKTju2qmCDG83SnVHzsiNj70MiviqiLpgz72IxjF+xN4bRw8I5dD0GwwO8kDoJUGWgTds+VckCwdtZA65oui9Osk5t1a4pg6Xu9+HFcEuqwJTDxATvGAz1/YW0oUisjM0ObKTRDVSfnTYeaBsN6L+M+8gCwIDAQAB";
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { csrftoken: "t", auth: { cfg: { publicKey: spki } } } },
  })}</script>`;
  const o = parseSigninPageHtmlProps(html);
  assert.equal(o.rsaPublicKeyMaterial, spki);
});

test("parseSigninPageHtmlProps: regex fallback for modulus in HTML", () => {
  const mod = "a".repeat(256);
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { csrftoken: "t" } },
  })}</script>extra "modulus":"${mod}"`;
  const o = parseSigninPageHtmlProps(html);
  assert.equal(o.rsaPublicKeyMaterial, mod);
});

test("parseSigninPageHtmlProps: RSA material under props but outside pageProps", () => {
  const spki =
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4E+eiWRwffhRIPQYvlXUjf0b3HqCmosiCxbFCYI/gdfDBhrTUzbt3fL3o/gRQQBEPf69vhJMFH2ZMtaJM6ohE3yQef331liPVM0YvqMOgvoID+zDa1NIZFObSsjOKhvZtv9esO0REeiVEPKNc+Dp6il3x7TV9VKGEv0+iriNjqv7TGAexo2jVtLm50iVKTju2qmCDG83SnVHzsiNj70MiviqiLpgz72IxjF+xN4bRw8I5dD0GwwO8kDoJUGWgTds+VckCwdtZA65oui9Osk5t1a4pg6Xu9+HFcEuqwJTDxATvGAz1/YW0oUisjM0ObKTRDVSfnTYeaBsN6L+M+8gCwIDAQAB";
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: { csrftoken: "t", challenge: "c" },
      extra: { rsaPublicKey: spki },
    },
  })}</script>`;
  const o = parseSigninPageHtmlProps(html);
  assert.equal(o.rsaPublicKeyMaterial, spki);
});

test("rsaModulusHexToSpkiPem: default (DIP/ISF) modulus yields PEM with BEGIN PUBLIC KEY", () => {
  const pem = rsaModulusHexToSpkiPem(DEFAULT_SIGNIN_RSA_MODULUS_HEX);
  assert.ok(pem.includes("BEGIN PUBLIC KEY"));
  assert.ok(pem.includes("END PUBLIC KEY"));
});

test("rsaModulusHexToSpkiPem: Studio modulus yields PEM with BEGIN PUBLIC KEY", () => {
  const pem = rsaModulusHexToSpkiPem(STUDIO_SIGNIN_RSA_MODULUS_HEX);
  assert.ok(pem.includes("BEGIN PUBLIC KEY"));
  assert.ok(pem.includes("END PUBLIC KEY"));
});

test("rsaModulusHexToSpkiPem: rejects odd-length hex", () => {
  assert.throws(() => rsaModulusHexToSpkiPem("abc"), /even-length/);
});
