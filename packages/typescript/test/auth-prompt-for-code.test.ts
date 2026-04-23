import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { promptForCode } from "../src/auth/oauth.js";

const STATE = "abc-state-123";
const PORT = 9010;
const AUTH_URL = "https://example.com/oauth2/auth?state=" + STATE;

function devNull(): Writable {
  return new Writable({ write(_c, _e, cb) { cb(); } });
}

test("promptForCode returns the authorization code from a pasted callback URL", async () => {
  const pasted =
    `http://127.0.0.1:${PORT}/callback?code=ory_ac_demo123&scope=openid+offline+all&state=${STATE}\n`;
  const code = await promptForCode(AUTH_URL, STATE, PORT, "explicit", {
    input: Readable.from([pasted]),
    output: devNull(),
  });
  assert.equal(code, "ory_ac_demo123");
});

test("promptForCode returns the raw code when only the code value is pasted", async () => {
  const code = await promptForCode(AUTH_URL, STATE, PORT, "explicit", {
    input: Readable.from(["plain-code-xyz\n"]),
    output: devNull(),
  });
  assert.equal(code, "plain-code-xyz");
});

test("promptForCode rejects when state does not match (CSRF guard)", async () => {
  const pasted =
    `http://127.0.0.1:${PORT}/callback?code=foo&state=DIFFERENT\n`;
  await assert.rejects(
    promptForCode(AUTH_URL, STATE, PORT, "explicit", {
      input: Readable.from([pasted]),
      output: devNull(),
    }),
    /state mismatch/i,
  );
});

test("promptForCode surfaces authorization errors when callback URL contains both code and error params", async () => {
  // Note: the error branch only fires when the URL also has `code=` (which is what triggers
  // the URL-parsing path). A bare error redirect without `code=` is currently treated as a
  // raw code by promptForCode — that is a separate, pre-existing issue.
  const pasted =
    `http://127.0.0.1:${PORT}/callback?code=ignored&error=access_denied&error_description=user%20denied&state=${STATE}\n`;
  await assert.rejects(
    promptForCode(AUTH_URL, STATE, PORT, "explicit", {
      input: Readable.from([pasted]),
      output: devNull(),
    }),
    /Authorization failed: access_denied — user denied/,
  );
});

test("promptForCode rejects with 'Login cancelled.' when stdin closes before any input", async () => {
  await assert.rejects(
    promptForCode(AUTH_URL, STATE, PORT, "explicit", {
      input: Readable.from([]),
      output: devNull(),
    }),
    /Login cancelled\./,
  );
});

test("promptForCode rejects when input is empty (just a newline)", async () => {
  await assert.rejects(
    promptForCode(AUTH_URL, STATE, PORT, "explicit", {
      input: Readable.from(["\n"]),
      output: devNull(),
    }),
    /No authorization code entered\./,
  );
});
