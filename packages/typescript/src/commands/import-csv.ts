import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse } from "csv-parse/sync";
import type { DataflowCreateBody } from "../api/dataflow.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CsvData {
  headers: string[];
  rows: Array<Record<string, string | null>>;
}

export interface FieldMapping {
  source: { name: string };
  target: { name: string; data_type: string };
}

export interface DagBodyOptions {
  datasourceId: string;
  datasourceType: string;
  tableName: string;
  tableExist: boolean;
  data: Array<Record<string, string | null>>;
  fieldMappings: FieldMapping[];
  /** When true on the first batch (`tableExist` false), use overwrite to drop/recreate table before import. */
  recreate?: boolean;
}

// ── parseCsvFile ──────────────────────────────────────────────────────────────

/**
 * Read a CSV file and return its headers and rows.
 * - Strips UTF-8 BOM if present
 * - Converts empty strings to null
 * - Throws on column count mismatch
 */
export async function parseCsvFile(filePath: string): Promise<CsvData> {
  let content = await readFile(filePath, "utf8");

  // Strip UTF-8 BOM
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // Parse with columns:true to get key/value rows
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
  }) as Array<Record<string, string>>;

  // If no records, parse just first row to extract headers
  if (records.length === 0) {
    const headerRows = parse(content, {
      columns: false,
      skip_empty_lines: false,
      trim: true,
      to: 1,
    }) as string[][];

    const headers = (headerRows[0] ?? []) as string[];
    return { headers, rows: [] };
  }

  const headers = Object.keys(records[0]!);

  // Convert empty strings to null
  const rows = records.map((record) => {
    const row: Record<string, string | null> = {};
    for (const key of headers) {
      const val = record[key];
      row[key] = val === "" ? null : (val ?? null);
    }
    return row;
  });

  return { headers, rows };
}

// ── buildTableName ────────────────────────────────────────────────────────────

/**
 * Derive a table name from a file path: strip .csv (case-insensitive) and prepend prefix.
 */
export function buildTableName(filePath: string, prefix: string): string {
  const base = basename(filePath).replace(/\.csv$/i, "");
  return prefix + base;
}

// ── splitBatches ──────────────────────────────────────────────────────────────

/**
 * Split an array into chunks of at most `batchSize` elements.
 */
export function splitBatches<T>(rows: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }
  return batches;
}

// ── buildFieldMappings ────────────────────────────────────────────────────────

/**
 * Build field mapping descriptors from CSV headers.
 * All target fields default to VARCHAR(512).
 */
export function buildFieldMappings(headers: string[]): FieldMapping[] {
  return headers.map((name) => ({
    source: { name },
    target: { name, data_type: "VARCHAR(512)" },
  }));
}

// ── buildDagBody ──────────────────────────────────────────────────────────────

/**
 * Construct a DataflowCreateBody for a CSV → database write operation.
 * The DAG has two steps: a manual trigger and the database write.
 */
export function buildDagBody(options: DagBodyOptions): DataflowCreateBody {
  const { datasourceId, datasourceType, tableName, tableExist, data, fieldMappings, recreate } = options;
  const ts = Date.now();
  const operateType = tableExist ? "append" : recreate ? "overwrite" : "append";

  const triggerStep = {
    id: "step-trigger",
    title: "Trigger",
    operator: "@trigger/manual",
    parameters: {},
  };

  const writeStep = {
    id: "step-write",
    title: "Write to Database",
    operator: "@internal/database/write",
    parameters: {
      datasource_type: datasourceType,
      datasource_id: datasourceId,
      table_name: tableName,
      table_exist: tableExist,
      operate_type: operateType,
      data,
      sync_model_fields: fieldMappings,
    },
  };

  return {
    title: `import-csv-${tableName}-${ts}`,
    description: `CSV import into table ${tableName}`,
    trigger_config: { operator: "@internal/trigger/manual" },
    steps: [triggerStep, writeStep],
  };
}
