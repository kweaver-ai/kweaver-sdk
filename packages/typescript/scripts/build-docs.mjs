#!/usr/bin/env node
/**
 * Build TypeDoc HTML for English (default) or Chinese UI.
 *
 * Usage:
 *   node scripts/build-docs.mjs           # English UI
 *   node scripts/build-docs.mjs --zh      # Chinese UI strings + README.zh.md
 *
 * Env:
 *   TYPEDOC_GIT_REVISION  — overrides "Defined in" gitRevision (default GITHUB_SHA, then "main")
 */
import { Application, TSConfigReader, TypeDocReader } from "typedoc";

const isZh = process.argv.includes("--zh");
const gitRevision =
  process.env.TYPEDOC_GIT_REVISION || process.env.GITHUB_SHA || "main";

const dynamicOptions = {
  options: "typedoc.json",
  lang: isZh ? "zh" : "en",
  readme: isZh ? "README.zh.md" : "README.md",
  out: isZh
    ? "../../docs/reference/typescript-api-html-zh"
    : "../../docs/reference/typescript-api-html",
  gitRevision,
};

const app = await Application.bootstrapWithPlugins(dynamicOptions, [
  new TypeDocReader(),
  new TSConfigReader(),
]);

const project = await app.convert();
if (!project) {
  console.error("[build-docs] TypeDoc conversion failed");
  process.exit(1);
}
await app.generateOutputs(project);
console.log(
  `[build-docs] generated ${isZh ? "zh" : "en"} docs at ${dynamicOptions.out} (gitRevision=${gitRevision})`
);
