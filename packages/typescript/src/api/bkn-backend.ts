import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

export interface UploadBknOptions {
  baseUrl: string;
  accessToken: string;
  tarBuffer: Buffer;
  businessDomain?: string;
  branch?: string;
}

export async function uploadBkn(options: UploadBknOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    tarBuffer,
    businessDomain = "bd_public",
    branch = "main",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/bkn-backend/v1/bkns`);
  url.searchParams.set("branch", branch);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(tarBuffer)], { type: "application/octet-stream" }), "bkn.tar");

  const headers = buildHeaders(accessToken, businessDomain);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: form,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface BknBackendBaseOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export interface BknBackendKnOptions extends BknBackendBaseOptions {
  knId: string;
}

const BKN_BASE = "/api/bkn-backend/v1";

export function knUrl(baseUrl: string, knId: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${BKN_BASE}/knowledge-networks/${encodeURIComponent(knId)}/${path}`;
}

function baseUrlOnly(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${BKN_BASE}/${path}`;
}

async function bknGet(url: string, accessToken: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, { method: "GET", headers: buildHeaders(accessToken, businessDomain) });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

async function bknPost(url: string, accessToken: string, reqBody: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: reqBody,
  });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

async function bknPut(url: string, accessToken: string, reqBody: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: reqBody,
  });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

async function bknDelete(url: string, accessToken: string, businessDomain = "bd_public"): Promise<string> {
  const response = await fetch(url, { method: "DELETE", headers: buildHeaders(accessToken, businessDomain) });
  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

// ---------------------------------------------------------------------------
// Concept Groups
// ---------------------------------------------------------------------------

export interface ConceptGroupOptions extends BknBackendKnOptions { cgId: string; }
export interface ConceptGroupBodyOptions extends BknBackendKnOptions { body: string; }
export interface ConceptGroupMutateOptions extends ConceptGroupOptions { body: string; }
export interface ConceptGroupRemoveMembersOptions extends ConceptGroupOptions { otIds: string; }

export function listConceptGroups(opts: BknBackendKnOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, "concept-groups"), opts.accessToken, opts.businessDomain);
}
export function getConceptGroup(opts: ConceptGroupOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}`), opts.accessToken, opts.businessDomain);
}
export function createConceptGroup(opts: ConceptGroupBodyOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, "concept-groups"), opts.accessToken, opts.body, opts.businessDomain);
}
export function updateConceptGroup(opts: ConceptGroupMutateOptions): Promise<string> {
  return bknPut(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}`), opts.accessToken, opts.body, opts.businessDomain);
}
export function deleteConceptGroup(opts: ConceptGroupOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}`), opts.accessToken, opts.businessDomain);
}
export function addConceptGroupMembers(opts: ConceptGroupMutateOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}/object-types`), opts.accessToken, opts.body, opts.businessDomain);
}
export function removeConceptGroupMembers(opts: ConceptGroupRemoveMembersOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `concept-groups/${encodeURIComponent(opts.cgId)}/object-types/${opts.otIds}`), opts.accessToken, opts.businessDomain);
}

// ---------------------------------------------------------------------------
// Action Schedules
// ---------------------------------------------------------------------------

export interface ActionScheduleOptions extends BknBackendKnOptions { scheduleId: string; }
export interface ActionScheduleBodyOptions extends BknBackendKnOptions { body: string; }
export interface ActionScheduleMutateOptions extends ActionScheduleOptions { body: string; }
export interface ActionScheduleDeleteOptions extends BknBackendKnOptions { scheduleIds: string; }

export function listActionSchedules(opts: BknBackendKnOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, "action-schedules"), opts.accessToken, opts.businessDomain);
}
export function getActionSchedule(opts: ActionScheduleOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `action-schedules/${encodeURIComponent(opts.scheduleId)}`), opts.accessToken, opts.businessDomain);
}
export function createActionSchedule(opts: ActionScheduleBodyOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, "action-schedules"), opts.accessToken, opts.body, opts.businessDomain);
}
export function updateActionSchedule(opts: ActionScheduleMutateOptions): Promise<string> {
  return bknPut(knUrl(opts.baseUrl, opts.knId, `action-schedules/${encodeURIComponent(opts.scheduleId)}`), opts.accessToken, opts.body, opts.businessDomain);
}
export function setActionScheduleStatus(opts: ActionScheduleMutateOptions): Promise<string> {
  return bknPut(knUrl(opts.baseUrl, opts.knId, `action-schedules/${encodeURIComponent(opts.scheduleId)}/status`), opts.accessToken, opts.body, opts.businessDomain);
}
export function deleteActionSchedules(opts: ActionScheduleDeleteOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `action-schedules/${opts.scheduleIds}`), opts.accessToken, opts.businessDomain);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobOptions extends BknBackendKnOptions { jobId: string; }
export interface JobDeleteOptions extends BknBackendKnOptions { jobIds: string; }

export function listJobs(opts: BknBackendKnOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, "jobs"), opts.accessToken, opts.businessDomain);
}
export function getJob(opts: JobOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `jobs/${encodeURIComponent(opts.jobId)}`), opts.accessToken, opts.businessDomain);
}
export function getJobTasks(opts: JobOptions): Promise<string> {
  return bknGet(knUrl(opts.baseUrl, opts.knId, `jobs/${encodeURIComponent(opts.jobId)}/tasks`), opts.accessToken, opts.businessDomain);
}
export function deleteJobs(opts: JobDeleteOptions): Promise<string> {
  return bknDelete(knUrl(opts.baseUrl, opts.knId, `jobs/${opts.jobIds}`), opts.accessToken, opts.businessDomain);
}

// ---------------------------------------------------------------------------
// Relation Type Paths & Resources
// ---------------------------------------------------------------------------

export interface RelationTypePathsOptions extends BknBackendKnOptions { body: string; }

export function queryRelationTypePaths(opts: RelationTypePathsOptions): Promise<string> {
  return bknPost(knUrl(opts.baseUrl, opts.knId, "relation-type-paths"), opts.accessToken, opts.body, opts.businessDomain);
}
export function listBknResources(opts: BknBackendBaseOptions): Promise<string> {
  return bknGet(baseUrlOnly(opts.baseUrl, "resources"), opts.accessToken, opts.businessDomain);
}

// ---------------------------------------------------------------------------

export interface DownloadBknOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  businessDomain?: string;
  branch?: string;
}

export async function downloadBkn(options: DownloadBknOptions): Promise<Buffer> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
    branch = "main",
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/bkn-backend/v1/bkns/${encodeURIComponent(knId)}`);
  url.searchParams.set("branch", branch);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(response.status, response.statusText, body);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
