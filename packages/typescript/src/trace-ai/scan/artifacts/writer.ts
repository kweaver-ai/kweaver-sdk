import fs from "node:fs/promises";
import path from "node:path";

export interface RunMetadata {
  cli_args: Record<string, unknown>;
  agent_id: string;
  rule_load_summary: {
    rules_applied: string[];
    rules_skipped_at_load: string[];
    rules_dir: string;
  };
  single_agent_validation: {
    checked_conv_ids: number;
    agent_id_resolved: string;
  };
  timing: {
    stage_1_ms: number;
    stage_2_ms: number;
    stage_3_ms: number;
    stage_4_ms: number;
    total_ms: number;
  };
  llm_calls: {
    stage_2_chunks: number;
    stage_3: number;
    stage_4: number;
    total: number;
  };
  cost_estimate_usd: {
    stage_2: number;
    stage_4: number;
    total: number;
    model_price_table_version: string;
  };
}

export interface ArtifactWriterOpts {
  /** Base directory; everything else is relative to this. */
  base: string;
  /** When false, all write methods are no-ops. */
  enabled: boolean;
}

/**
 * Persists each Stage's LLM I/O to disk so users can trace why a diagnosis
 * came out the way it did. Used by both single-trace (PR-B `diagnose()`) and
 * batch (`runBatch()`); only the directory base differs.
 *
 * Layout (under `base`):
 *   run-metadata.json
 *   stage-2-rubric/<rule_id>/{work-queue.json, chunk-NNN.{prompt.md, response.json, parse-errors.json}}
 *   stage-3-synth/{prompt.md, response.json}             ← single-trace only
 *   stage-4-cross-trace-synth/{aggregates.json, samples.json, prompt.md, response.json, parse-errors.json}  ← batch only
 */
export class ArtifactWriter {
  private base: string;
  private enabled: boolean;

  constructor(opts: ArtifactWriterOpts) {
    this.base = opts.base;
    this.enabled = opts.enabled;
  }

  private async ensureDir(rel: string): Promise<string> {
    const abs = path.join(this.base, rel);
    await fs.mkdir(abs, { recursive: true });
    return abs;
  }

  private chunkSlug(idx: number): string {
    return `chunk-${String(idx).padStart(3, "0")}`;
  }

  async writeStageTwoWorkQueue(ruleId: string, convIds: string[]): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, "work-queue.json"), JSON.stringify(convIds, null, 2), "utf8");
  }

  async writeStageTwoPrompt(ruleId: string, chunkIdx: number, prompt: string): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, `${this.chunkSlug(chunkIdx)}.prompt.md`), prompt, "utf8");
  }

  async writeStageTwoResponse(ruleId: string, chunkIdx: number, response: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, `${this.chunkSlug(chunkIdx)}.response.json`), JSON.stringify(response, null, 2), "utf8");
  }

  async writeStageTwoParseErrors(ruleId: string, chunkIdx: number, errors: unknown[]): Promise<void> {
    if (!this.enabled || errors.length === 0) return;
    const dir = await this.ensureDir(path.join("stage-2-rubric", ruleId));
    await fs.writeFile(path.join(dir, `${this.chunkSlug(chunkIdx)}.parse-errors.json`), JSON.stringify(errors, null, 2), "utf8");
  }

  async writeStageThreeSynthPrompt(prompt: string): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-3-synth");
    await fs.writeFile(path.join(dir, "prompt.md"), prompt, "utf8");
  }

  async writeStageThreeSynthResponse(response: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-3-synth");
    await fs.writeFile(path.join(dir, "response.json"), JSON.stringify(response, null, 2), "utf8");
  }

  async writeStageFourInputs(aggregates: unknown, samples: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "aggregates.json"), JSON.stringify(aggregates, null, 2), "utf8");
    await fs.writeFile(path.join(dir, "samples.json"), JSON.stringify(samples, null, 2), "utf8");
  }

  async writeStageFourPrompt(prompt: string): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "prompt.md"), prompt, "utf8");
  }

  async writeStageFourResponse(response: unknown): Promise<void> {
    if (!this.enabled) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "response.json"), JSON.stringify(response, null, 2), "utf8");
  }

  async writeStageFourParseErrors(errors: unknown[]): Promise<void> {
    if (!this.enabled || errors.length === 0) return;
    const dir = await this.ensureDir("stage-4-cross-trace-synth");
    await fs.writeFile(path.join(dir, "parse-errors.json"), JSON.stringify(errors, null, 2), "utf8");
  }

  async writeRunMetadata(meta: RunMetadata): Promise<void> {
    if (!this.enabled) return;
    await fs.mkdir(this.base, { recursive: true });
    await fs.writeFile(path.join(this.base, "run-metadata.json"), JSON.stringify(meta, null, 2), "utf8");
  }
}
