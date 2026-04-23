/**
 * Example 06: Full Pipeline — from datasource to intelligent search
 *
 * Demonstrates: Datasource registration, BKN creation from datasource,
 * build + wait, semantic search, resource cleanup.
 *
 * DESTRUCTIVE: This example creates and deletes resources.
 *
 * Prerequisites:
 *   - A reachable MySQL database
 *   - Set environment variables: KWEAVER_TEST_DB_HOST, KWEAVER_TEST_DB_PORT,
 *     KWEAVER_TEST_DB_NAME, KWEAVER_TEST_DB_USER, KWEAVER_TEST_DB_PASS
 *
 * Run: npx tsx examples/sdk/06-full-pipeline.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient, pp } from "./setup.js";

const exec = promisify(execFile);

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await exec("npx", ["tsx", "packages/typescript/src/cli.ts", ...args]);
  return result;
}

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  // Require explicit opt-in for destructive operations
  if (process.env.RUN_DESTRUCTIVE !== "1") {
    console.log("This example creates and deletes resources.");
    console.log("Set RUN_DESTRUCTIVE=1 to run it.");
    return;
  }

  const dbHost = requireEnv("KWEAVER_TEST_DB_HOST");
  const dbPort = requireEnv("KWEAVER_TEST_DB_PORT", "3306");
  const dbName = requireEnv("KWEAVER_TEST_DB_NAME");
  const dbUser = requireEnv("KWEAVER_TEST_DB_USER");
  const dbPass = requireEnv("KWEAVER_TEST_DB_PASS");
  const dbType = requireEnv("KWEAVER_TEST_DB_TYPE", "mysql");
  const dsName = `example_pipeline_${Date.now()}`;
  const knName = `example_pipeline_${Date.now()}`;

  let dsId: string | undefined;
  let knId: string | undefined;

  try {
    // Step 1: Register datasource
    console.log("=== Step 1: Register Datasource ===");
    const dsResult = await runCli([
      "ds", "connect", dbType, dbHost, dbPort, dbName,
      "--account", dbUser, "--password", dbPass,
      "--name", dsName,
    ]);
    const dsParsed = JSON.parse(dsResult.stdout);
    dsId = String(dsParsed?.id ?? dsParsed?.ds_id ?? "");
    console.log(`Created datasource: ${dsName} (${dsId})\n`);

    // Step 2: Create BKN from datasource (creates DataViews, object types, etc.)
    console.log("=== Step 2: Create BKN from Datasource ===");
    const knResult = await runCli([
      "bkn", "create-from-ds", dsId,
      "--name", knName,
      "--no-build",
    ]);
    const knParsed = JSON.parse(knResult.stdout);
    knId = String(knParsed?.kn_id ?? knParsed?.id ?? "");
    console.log(`Created BKN: ${knName} (${knId})\n`);

    // Step 3: Build the knowledge network index
    console.log("=== Step 3: Build BKN ===");
    const client = await createClient();
    console.log("Building... (this may take a while)");
    const buildStatus = await client.knowledgeNetworks.buildAndWait(knId, {
      timeout: 300_000,
      interval: 5_000,
    });
    console.log("Build complete:", buildStatus);

    // Step 4: Export the BKN to see what was created
    console.log("\n=== Step 4: Export BKN ===");
    const exportResult = await runCli(["bkn", "export", knId]);
    const exported = JSON.parse(exportResult.stdout);
    console.log("Exported schema:");
    pp(exported);

    // Step 5: Semantic search on the new BKN
    console.log("\n=== Step 5: Semantic Search ===");
    const searchResult = await client.bkn.semanticSearch(knId, "数据");
    console.log("Search results:");
    pp(searchResult);

  } finally {
    // Cleanup: delete created resources
    console.log("\n=== Cleanup ===");
    if (knId) {
      try {
        await runCli(["bkn", "delete", knId, "-y"]);
        console.log(`Deleted BKN: ${knId}`);
      } catch (e) {
        console.error(`Failed to delete BKN: ${(e as Error).message}`);
      }
    }
    if (dsId) {
      try {
        await runCli(["ds", "delete", dsId, "-y"]);
        console.log(`Deleted datasource: ${dsId}`);
      } catch (e) {
        console.error(`Failed to delete datasource: ${(e as Error).message}`);
      }
    }
  }
}

main().catch(console.error);
