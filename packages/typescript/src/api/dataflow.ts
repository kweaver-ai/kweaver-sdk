import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

function debugLog(method: string, url: string, headers: Record<string, string>, body?: string): void {
  if (!process.env["KWEAVER_DEBUG_HTTP"]) return;
  const masked = { ...headers };
  if (masked.authorization) masked.authorization = masked.authorization.slice(0, 20) + "…";
  if (masked.token) masked.token = masked.token.slice(0, 20) + "…";
  process.stderr.write(`[debug] ${method} ${url}\n`);
  process.stderr.write(`[debug] headers: ${JSON.stringify(masked)}\n`);
  if (body) process.stderr.write(`[debug] body (first 300): ${body.slice(0, 300)}\n`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataflowStep {
  id: string;
  title: string;
  operator: string;
  parameters: Record<string, unknown>;
}

export interface DataflowCreateBody {
  title: string;
  description?: string;
  trigger_config: { operator: string };
  steps: DataflowStep[];
}

export interface DataflowResult {
  status: "success" | "completed" | "failed" | "error";
  reason?: string;
}

// ── createDataflow ────────────────────────────────────────────────────────────

export interface CreateDataflowOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: DataflowCreateBody;
}

/**
 * Create a new dataflow (DAG). Returns the new DAG id.
 */
export async function createDataflow(options: CreateDataflowOptions): Promise<string> {
  const { baseUrl, accessToken, businessDomain = "bd_public", body } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v1/data-flow/flow`;
  const reqHeaders = { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" };
  const reqBody = JSON.stringify(body);
  debugLog("POST", url, reqHeaders, reqBody);

  const response = await fetch(url, {
    method: "POST",
    headers: reqHeaders,
    body: reqBody,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, responseBody);
  }

  const parsed = JSON.parse(responseBody) as { id: string };
  return parsed.id;
}

// ── runDataflow ───────────────────────────────────────────────────────────────

export interface RunDataflowOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  dagId: string;
}

/**
 * Trigger a run for an existing dataflow DAG.
 */
export async function runDataflow(options: RunDataflowOptions): Promise<void> {
  const { baseUrl, accessToken, businessDomain = "bd_public", dagId } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v1/run-instance/${encodeURIComponent(dagId)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: "{}",
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new HttpError(response.status, response.statusText, responseBody);
  }
}

// ── pollDataflowResults ───────────────────────────────────────────────────────

export interface PollDataflowOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  dagId: string;
  /** Poll interval in seconds. Default: 3 */
  interval?: number;
  /** Maximum time to wait in seconds. Default: 900 */
  timeout?: number;
  /** Test injection: override sleep function. */
  _sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll GET /api/automation/v1/dag/{dagId}/results until the run is done.
 * Throws on "failed"/"error" status or timeout.
 */
export async function pollDataflowResults(options: PollDataflowOptions): Promise<DataflowResult> {
  const {
    baseUrl,
    accessToken,
    businessDomain = "bd_public",
    dagId,
    interval = 3,
    timeout = 900,
    _sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v1/dag/${encodeURIComponent(dagId)}/results`;

  const deadlineMs = Date.now() + timeout * 1000;
  let currentInterval = interval;

  while (Date.now() < deadlineMs) {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(accessToken, businessDomain),
    });

    const responseBody = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, responseBody);
    }

    const parsed = JSON.parse(responseBody) as { results?: DataflowResult[] };
    const results = parsed.results ?? [];
    const latest = results[0];

    if (latest) {
      if (latest.status === "success" || latest.status === "completed") {
        return latest;
      }
      if (latest.status === "failed" || latest.status === "error") {
        const reasonVal = latest.reason;
        const reason = reasonVal
          ? `: ${typeof reasonVal === "string" ? reasonVal : JSON.stringify(reasonVal)}`
          : "";
        throw new Error(`Dataflow run ${latest.status}${reason}`);
      }
    }

    // Still running — wait before next poll
    if (currentInterval > 0) {
      await _sleep(currentInterval * 1000);
    }
    currentInterval = Math.min(currentInterval * 2, 30);
  }

  throw new Error(`Dataflow polling timed out after ${timeout}s for DAG ${dagId}`);
}

// ── deleteDataflow ────────────────────────────────────────────────────────────

export interface DeleteDataflowOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  dagId: string;
}

/**
 * Delete a dataflow DAG. Best-effort — does not throw on errors.
 */
export async function deleteDataflow(options: DeleteDataflowOptions): Promise<void> {
  const { baseUrl, accessToken, businessDomain = "bd_public", dagId } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v1/data-flow/flow/${encodeURIComponent(dagId)}`;

  try {
    await fetch(url, {
      method: "DELETE",
      headers: buildHeaders(accessToken, businessDomain),
    });
  } catch {
    // Best-effort: swallow all errors
  }
}

// ── executeDataflow ───────────────────────────────────────────────────────────

export interface ExecuteDataflowOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  body: DataflowCreateBody;
  /** Poll interval in seconds. Default: 3 */
  interval?: number;
  /** Maximum polling time in seconds. Default: 900 */
  timeout?: number;
}

/**
 * Full dataflow lifecycle: create → run → poll → delete (always, even on error).
 * Returns the final DataflowResult.
 */
export async function executeDataflow(options: ExecuteDataflowOptions): Promise<DataflowResult> {
  const { baseUrl, accessToken, businessDomain = "bd_public", body, interval, timeout } = options;

  const dagId = await createDataflow({ baseUrl, accessToken, businessDomain, body });

  try {
    await runDataflow({ baseUrl, accessToken, businessDomain, dagId });
    return await pollDataflowResults({ baseUrl, accessToken, businessDomain, dagId, interval, timeout });
  } finally {
    await deleteDataflow({ baseUrl, accessToken, businessDomain, dagId }).catch(() => {});
  }
}
