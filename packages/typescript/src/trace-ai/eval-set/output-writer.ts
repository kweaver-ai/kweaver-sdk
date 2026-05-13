/**
 * M5 eval-set output writer — handles directory layout, index upsert, shard
 * merge, on-conflict resolution (fail / skip / overwrite), and .bak preservation.
 *
 * MVP layout: always one shard named `cases.yaml`. Users can manually split
 * into multi-shard later (re-write `index.yaml` to reference more shards)
 * and call `kweaver trace schema validate` to verify.
 */

import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import type { EvalCase, EvalSetIndex } from "./types.js";
import { EvalSetIndexSchema, EvalSetShardSchema } from "./schemas.js";

export class WriterError extends Error {
  constructor(
    message: string,
    public readonly conflictIds?: string[],
  ) {
    super(message);
    this.name = "WriterError";
  }
}

export type ConflictStrategy = "fail" | "skip" | "overwrite";

export interface WriteEvalSetOpts {
  outDir: string;
  evalSetId: string;
  newCases: EvalCase[];
  onConflict: ConflictStrategy;
}

export interface WriteEvalSetResult {
  cases_written: number;
  cases_skipped: number;
  conflicts: string[];
  shard_paths: string[];
}

const SHARD_NAME = "cases.yaml";
const INDEX_NAME = "index.yaml";

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

async function readShardCases(shardPath: string): Promise<EvalCase[]> {
  if (!(await fileExists(shardPath))) return [];
  const raw = await readFile(shardPath, "utf8");
  const parsed = yaml.load(raw);
  const r = EvalSetShardSchema.safeParse(parsed);
  if (!r.success) {
    throw new WriterError(
      `existing shard at ${shardPath} fails schema validation: ${r.error.issues[0].message}`,
    );
  }
  return r.data.cases as EvalCase[];
}

export async function writeEvalSet(opts: WriteEvalSetOpts): Promise<WriteEvalSetResult> {
  const { outDir, evalSetId, newCases, onConflict } = opts;

  // intra-batch duplicate detection
  const seenInBatch = new Set<string>();
  const dupInBatch: string[] = [];
  for (const c of newCases) {
    if (seenInBatch.has(c.query_id)) dupInBatch.push(c.query_id);
    seenInBatch.add(c.query_id);
  }
  if (dupInBatch.length > 0) {
    throw new WriterError(
      `intra-batch duplicate query_id(s): ${dupInBatch.join(", ")}`,
      dupInBatch,
    );
  }

  await mkdir(outDir, { recursive: true });
  const shardPath = path.join(outDir, SHARD_NAME);

  const existingCases = await readShardCases(shardPath);
  const existingIds = new Set(existingCases.map((c) => c.query_id));

  const incomingByConflict = newCases.filter((c) => existingIds.has(c.query_id));
  const incomingFresh = newCases.filter((c) => !existingIds.has(c.query_id));

  if (incomingByConflict.length > 0 && onConflict === "fail") {
    throw new WriterError(
      `query_id conflict(s): ${incomingByConflict.map((c) => c.query_id).join(", ")}`,
      incomingByConflict.map((c) => c.query_id),
    );
  }

  let mergedCases: EvalCase[];
  let casesWritten = 0;
  let casesSkipped = 0;

  if (onConflict === "skip") {
    mergedCases = [...existingCases, ...incomingFresh];
    casesWritten = incomingFresh.length;
    casesSkipped = incomingByConflict.length;
  } else if (onConflict === "overwrite") {
    if (incomingByConflict.length > 0 && (await fileExists(shardPath))) {
      await copyFile(shardPath, shardPath + ".bak");
    }
    const overwriteIds = new Set(incomingByConflict.map((c) => c.query_id));
    const kept = existingCases.filter((c) => !overwriteIds.has(c.query_id));
    mergedCases = [...kept, ...incomingFresh, ...incomingByConflict];
    casesWritten = incomingFresh.length + incomingByConflict.length;
    casesSkipped = 0;
  } else {
    // "fail" strategy — no conflicts at this point (would have thrown above)
    mergedCases = [...existingCases, ...incomingFresh];
    casesWritten = incomingFresh.length;
    casesSkipped = 0;
  }

  const shardDoc = {
    schema_version: "trace-eval-set/v1" as const,
    cases: mergedCases,
  };
  const shardCheck = EvalSetShardSchema.safeParse(shardDoc);
  if (!shardCheck.success) {
    throw new WriterError(
      `merged shard fails schema validation: ${shardCheck.error.issues[0].message}`,
    );
  }
  await writeFile(shardPath, yaml.dump(shardDoc, { lineWidth: 120, noRefs: true }), "utf8");

  const indexPath = path.join(outDir, INDEX_NAME);
  let indexDoc: EvalSetIndex;
  if (await fileExists(indexPath)) {
    const raw = await readFile(indexPath, "utf8");
    const parsed = yaml.load(raw);
    const r = EvalSetIndexSchema.safeParse(parsed);
    if (!r.success) {
      throw new WriterError(
        `existing index.yaml fails schema validation: ${r.error.issues[0].message}`,
      );
    }
    indexDoc = r.data as EvalSetIndex;
    if (!indexDoc.shards.some((s) => s.path === SHARD_NAME)) {
      indexDoc.shards.push({ path: SHARD_NAME });
    }
  } else {
    indexDoc = {
      schema_version: "trace-eval-set-index/v1",
      eval_set_id: evalSetId,
      shards: [{ path: SHARD_NAME }],
    };
  }
  await writeFile(indexPath, yaml.dump(indexDoc, { lineWidth: 120, noRefs: true }), "utf8");

  return {
    cases_written: casesWritten,
    cases_skipped: casesSkipped,
    conflicts: incomingByConflict.map((c) => c.query_id),
    shard_paths: [shardPath],
  };
}
