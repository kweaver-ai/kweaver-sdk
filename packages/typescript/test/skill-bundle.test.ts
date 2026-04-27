import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

import {
  bundleSkillDirectoryToZip,
  bundleSkillFileToZip,
  SkillBundleError,
} from "../src/utils/skill-bundle.js";

const ROOT = join(tmpdir(), `skill-bundle-test-${process.pid}`);

function freshDir(name: string): string {
  const dir = join(ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("setup", () => {
  mkdirSync(ROOT, { recursive: true });
});

test("bundleSkillDirectoryToZip: round-trips SKILL.md and asset files", async () => {
  const dir = freshDir("ok");
  writeFileSync(join(dir, "SKILL.md"), "---\nname: x\n---\nbody");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(join(dir, "data.json"), '{"k":1}');

  const bytes = await bundleSkillDirectoryToZip(dir);

  const zip = await JSZip.loadAsync(bytes);
  const fileNames = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name)
    .sort();
  assert.deepEqual(fileNames, ["SKILL.md", "data.json", "scripts/run.sh"]);
  assert.equal(await zip.file("SKILL.md")!.async("string"), "---\nname: x\n---\nbody");
  assert.equal(await zip.file("scripts/run.sh")!.async("string"), "#!/bin/sh\necho hi\n");
});

test("bundleSkillDirectoryToZip: rejects directory without SKILL.md", async () => {
  const dir = freshDir("no-skillmd");
  writeFileSync(join(dir, "readme.txt"), "nope");
  await assert.rejects(
    () => bundleSkillDirectoryToZip(dir),
    (err) => err instanceof SkillBundleError && /SKILL\.md not found/.test(err.message),
  );
});

test("bundleSkillDirectoryToZip: rejects empty directory", async () => {
  const dir = freshDir("empty");
  await assert.rejects(
    () => bundleSkillDirectoryToZip(dir),
    (err) => err instanceof SkillBundleError && /empty skill directory/.test(err.message),
  );
});

test("bundleSkillDirectoryToZip: rejects non-directory path", async () => {
  const dir = freshDir("file-path");
  const filePath = join(dir, "SKILL.md");
  writeFileSync(filePath, "x");
  await assert.rejects(
    () => bundleSkillDirectoryToZip(filePath),
    (err) => err instanceof SkillBundleError && /not a directory/.test(err.message),
  );
});

test("bundleSkillDirectoryToZip: posix-style paths inside zip on any platform", async () => {
  const dir = freshDir("nested");
  writeFileSync(join(dir, "SKILL.md"), "---\nname: y\n---\n");
  mkdirSync(join(dir, "a", "b", "c"), { recursive: true });
  writeFileSync(join(dir, "a", "b", "c", "leaf.txt"), "leaf");

  const bytes = await bundleSkillDirectoryToZip(dir);

  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file("a/b/c/leaf.txt"), "expected forward-slash path inside zip");
  // Make sure no backslash-bearing entries snuck in even on Windows hosts
  for (const name of Object.keys(zip.files)) {
    assert.ok(!name.includes("\\"), `entry contains backslash: ${name}`);
  }
});

test("bundleSkillFileToZip: wraps a SKILL.md into 1-file zip", async () => {
  const dir = freshDir("single");
  const filePath = join(dir, "SKILL.md");
  writeFileSync(filePath, "---\nname: solo\n---\nbody");

  const bytes = await bundleSkillFileToZip(filePath);

  const zip = await JSZip.loadAsync(bytes);
  const fileNames = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name);
  assert.deepEqual(fileNames, ["SKILL.md"]);
  assert.equal(await zip.file("SKILL.md")!.async("string"), "---\nname: solo\n---\nbody");
});

test("bundleSkillFileToZip: rejects non-SKILL.md filenames", async () => {
  const dir = freshDir("wrong-name");
  const filePath = join(dir, "guide.md");
  writeFileSync(filePath, "---\nname: x\n---\n");
  await assert.rejects(
    () => bundleSkillFileToZip(filePath),
    (err) => err instanceof SkillBundleError && /expects a file named SKILL\.md/.test(err.message),
  );
});

test("bundleSkillFileToZip: case-insensitive on filename", async () => {
  const dir = freshDir("case");
  const filePath = join(dir, "skill.md");
  writeFileSync(filePath, "---\nname: x\n---\n");
  await assert.doesNotReject(() => bundleSkillFileToZip(filePath));
});

test("bundleSkillFileToZip: rejects directory paths", async () => {
  const dir = freshDir("dir-as-file");
  await assert.rejects(
    () => bundleSkillFileToZip(dir),
    (err) => err instanceof SkillBundleError && /not a file/.test(err.message),
  );
});

test("teardown", () => {
  rmSync(ROOT, { recursive: true, force: true });
});
