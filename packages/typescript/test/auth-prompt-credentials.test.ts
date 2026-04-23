import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { promptForUsername, promptForPassword } from "../src/auth/oauth.js";

function devNull(): Writable {
  return new Writable({ write(_c, _e, cb) { cb(); } });
}

test("promptForUsername returns trimmed input", async () => {
  const value = await promptForUsername("Username", {
    input: Readable.from(["  alice@example.com  \n"]),
    output: devNull(),
  });
  assert.equal(value, "alice@example.com");
});

test("promptForUsername rejects on empty input (just a newline)", async () => {
  await assert.rejects(
    promptForUsername("Username", {
      input: Readable.from(["\n"]),
      output: devNull(),
    }),
    /Username is required\./,
  );
});

test("promptForUsername rejects with 'Login cancelled.' on EOF", async () => {
  await assert.rejects(
    promptForUsername("Username", {
      input: Readable.from([]),
      output: devNull(),
    }),
    /Login cancelled\./,
  );
});

test("promptForPassword (non-TTY): returns the password unchanged", async () => {
  // No setRawMode/isTTY → falls back to readline prompt; preserves the password verbatim
  // (no trim, since spaces could be intentional in passwords).
  const value = await promptForPassword("Password", {
    input: Readable.from(["s3cret with spaces\n"]),
    output: devNull(),
  });
  assert.equal(value, "s3cret with spaces");
});

test("promptForPassword (non-TTY): rejects on empty input", async () => {
  await assert.rejects(
    promptForPassword("Password", {
      input: Readable.from(["\n"]),
      output: devNull(),
    }),
    /Password is required\./,
  );
});

test("promptForPassword (non-TTY): rejects with 'Login cancelled.' on EOF", async () => {
  await assert.rejects(
    promptForPassword("Password", {
      input: Readable.from([]),
      output: devNull(),
    }),
    /Login cancelled\./,
  );
});
