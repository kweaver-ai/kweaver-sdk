// src/trace-ai/exp/exp-store/index.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ExpEvent, LineageEntry, Mission, NextChange, RoundData } from "../schemas.js";
import { readMission, writeSuggestedChange } from "./mission-md.js";
import { appendEvent, replayState, type ReplayedState } from "./events-jsonl.js";
import { acquireLock, releaseLock, updateHeartbeat } from "./lock.js";
import { isAborted, writeAbortSignal, clearAbortSignal } from "./abort-signal.js";
import { writeRound, readAllRounds } from "./round-yaml.js";
import { appendLineage, updateLineage, readLineage } from "./candidate-lineage-yaml.js";
import { renderReadme } from "./readme-template.js";

export { type ReplayedState };

export class ExpStore {
  constructor(readonly expDir: string) {}

  async initDir(mission: Mission): Promise<string> {
    const experimentId = `exp_${crypto.randomBytes(4).toString("hex")}`;
    await fs.mkdir(path.join(this.expDir, ".trace-state", "rounds"), { recursive: true });
    await fs.mkdir(path.join(this.expDir, "candidates"), { recursive: true });
    await fs.mkdir(path.join(this.expDir, "eval-sets"), { recursive: true });
    await fs.mkdir(path.join(this.expDir, "outputs"), { recursive: true });
    await fs.writeFile(
      path.join(this.expDir, ".trace-state", "events.jsonl"),
      "",
      { flag: "wx" }
    ).catch(() => {});  // already exists ok
    const readmePath = path.join(this.expDir, "README.md");
    try {
      await fs.access(readmePath);
    } catch {
      await fs.writeFile(readmePath, renderReadme({
        experimentId,
        timestamp: new Date().toISOString(),
        goal: mission.goal,
      }));
    }
    return experimentId;
  }

  async archiveState(): Promise<void> {
    const src = path.join(this.expDir, ".trace-state");
    const dst = path.join(this.expDir, `.trace-state-archived-${Date.now()}`);
    await fs.rename(src, dst);
    await fs.mkdir(path.join(this.expDir, ".trace-state", "rounds"), { recursive: true });
    await fs.writeFile(path.join(this.expDir, ".trace-state", "events.jsonl"), "");
  }

  readMission = () => readMission(this.expDir);
  writeSuggestedChange = (c: NextChange) => writeSuggestedChange(this.expDir, c);
  appendEvent = (e: Omit<ExpEvent, "ts">) => appendEvent(this.expDir, e);
  replayState = () => replayState(this.expDir);
  acquireLock = () => acquireLock(this.expDir);
  releaseLock = () => releaseLock(this.expDir);
  updateHeartbeat = () => updateHeartbeat(this.expDir);
  isAborted = () => isAborted(this.expDir);
  writeAbortSignal = () => writeAbortSignal(this.expDir);
  clearAbortSignal = () => clearAbortSignal(this.expDir);
  writeRound = (n: number, data: Partial<RoundData>) => writeRound(this.expDir, n, data);
  readAllRounds = () => readAllRounds(this.expDir);
  appendLineage = (e: Omit<LineageEntry, "appended_at">) => appendLineage(this.expDir, e);
  updateLineage = (v: number, p: Partial<LineageEntry>) => updateLineage(this.expDir, v, p);
  readLineage = () => readLineage(this.expDir);
}
