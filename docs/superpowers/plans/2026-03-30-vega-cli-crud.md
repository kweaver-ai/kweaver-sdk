# Vega CLI CRUD & Discovery-Task Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 12 new CLI commands (catalog/resource/connector-type CRUD + discovery-task list/get) with corresponding API functions and unit tests.

**Architecture:** API functions in `api/vega.ts` → CLI handlers in `commands/vega.ts` → SDK methods in `resources/vega.ts`. Each group (catalog, resource, connector-type, discovery-task) follows existing patterns. Delete commands use `-y` flag to skip confirmation prompt.

**Tech Stack:** TypeScript, Node.js built-in test runner, fetch API

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/typescript/src/api/vega.ts` | Modify | Add 11 new API functions (create/update/delete for catalog, resource, connector-type; enable connector-type; get discover-task) |
| `packages/typescript/src/commands/vega.ts` | Modify | Add 12 CLI command handlers + update help text + add `confirmYes` + add `discovery-task` router |
| `packages/typescript/src/resources/vega.ts` | Modify | Add 11 SDK wrapper methods |
| `packages/typescript/test/vega.test.ts` | Modify | Add unit tests for new API functions (URL/method/body verification) |
| `packages/typescript/test/e2e/vega.test.ts` | Modify | Add e2e tests for help text + read-only discovery-task commands |

---

### Task 1: Catalog CRUD — API Functions

**Files:**
- Modify: `packages/typescript/src/api/vega.ts:84` (after `listVegaCatalogs`)

- [ ] **Step 1: Write unit tests for catalog create/update/delete API functions**

Add to `packages/typescript/test/vega.test.ts`:

```typescript
test("createVegaCatalog sends POST to /catalogs with JSON body", async () => {
  const mock = mockFetch({ id: "new-cat-1" }, 201);
  try {
    const client = makeClient();
    await client.vega.createCatalog({
      name: "test-cat",
      connector_type: "mysql",
      connector_config: { host: "localhost" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.name, "test-cat");
    assert.equal(body.connector_type, "mysql");
  } finally {
    mock.restore();
  }
});

test("updateVegaCatalog sends PUT to /catalogs/:id", async () => {
  const mock = mockFetch("", 204);
  try {
    const client = makeClient();
    await client.vega.updateCatalog("cat-1", JSON.stringify({ name: "updated" }));
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/cat-1");
  } finally {
    mock.restore();
  }
});

test("deleteVegaCatalogs sends DELETE to /catalogs/:ids", async () => {
  const mock = mockFetch("", 204);
  try {
    const client = makeClient();
    await client.vega.deleteCatalogs("cat-1,cat-2");
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/cat-1,cat-2");
  } finally {
    mock.restore();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: FAIL — `client.vega.createCatalog is not a function`

- [ ] **Step 3: Add API functions to `api/vega.ts`**

Insert after `getVegaCatalog` function (after line ~114):

```typescript
export interface CreateVegaCatalogOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function createVegaCatalog(options: CreateVegaCatalogOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface UpdateVegaCatalogOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function updateVegaCatalog(options: UpdateVegaCatalogOptions): Promise<string> {
  const { baseUrl, accessToken, id, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaCatalogsOptions {
  baseUrl: string;
  accessToken: string;
  ids: string;
  businessDomain?: string;
}

export async function deleteVegaCatalogs(options: DeleteVegaCatalogsOptions): Promise<string> {
  const { baseUrl, accessToken, ids, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/catalogs/${ids}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}
```

- [ ] **Step 4: Add SDK wrapper methods to `resources/vega.ts`**

Add to `VegaResource` class after `catalogHealthStatus`:

```typescript
async createCatalog(data: {
  name: string;
  connector_type: string;
  connector_config: Record<string, unknown>;
  tags?: string[];
  description?: string;
}): Promise<unknown> {
  const raw = await createVegaCatalog({ ...this.ctx.base(), body: JSON.stringify(data) });
  return JSON.parse(raw);
}

async updateCatalog(id: string, body: string): Promise<unknown> {
  const raw = await updateVegaCatalog({ ...this.ctx.base(), id, body });
  return raw ? JSON.parse(raw) : {};
}

async deleteCatalogs(ids: string): Promise<unknown> {
  const raw = await deleteVegaCatalogs({ ...this.ctx.base(), ids });
  return raw ? JSON.parse(raw) : {};
}
```

Update the import in `resources/vega.ts` to include `createVegaCatalog`, `updateVegaCatalog`, `deleteVegaCatalogs`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: PASS — all 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/api/vega.ts packages/typescript/src/resources/vega.ts packages/typescript/test/vega.test.ts
git commit -m "feat(vega): add catalog create/update/delete API functions"
```

---

### Task 2: Catalog CRUD — CLI Commands

**Files:**
- Modify: `packages/typescript/src/commands/vega.ts`

- [ ] **Step 1: Add `confirmYes` helper and import `createInterface`**

At the top of `commands/vega.ts`, add the import:

```typescript
import { createInterface } from "node:readline";
```

Add the `confirmYes` helper after `parseCommonFlags`:

```typescript
function confirmYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}
```

- [ ] **Step 2: Add catalog create/update/delete imports and CLI handlers**

Add to the import block at top of `commands/vega.ts`:

```typescript
import {
  // ... existing imports ...
  createVegaCatalog,
  updateVegaCatalog,
  deleteVegaCatalogs,
} from "../api/vega.js";
```

Add to `runVegaCatalogCommand` dispatch (after `resources` line):

```typescript
if (sub === "create") return await runCatalogCreate(rest);
if (sub === "update") return await runCatalogUpdate(rest);
if (sub === "delete") return await runCatalogDelete(rest);
```

Add the three handler functions after `runCatalogResources`:

```typescript
// ---------------------------------------------------------------------------
// catalog create
// ---------------------------------------------------------------------------

async function runCatalogCreate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega catalog create [options]

Options:
  --name <name>               Catalog name (required)
  --connector-type <type>     Connector type (required)
  --connector-config <json>   Connector config JSON (required)
  --tags <t1,t2>              Comma-separated tags
  --description <text>        Description`);
    return 0;
  }

  let name: string | undefined;
  let connectorType: string | undefined;
  let connectorConfig: string | undefined;
  let tags: string | undefined;
  let description: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--name" && remaining[i + 1]) { name = remaining[++i]; continue; }
    if (arg === "--connector-type" && remaining[i + 1]) { connectorType = remaining[++i]; continue; }
    if (arg === "--connector-config" && remaining[i + 1]) { connectorConfig = remaining[++i]; continue; }
    if (arg === "--tags" && remaining[i + 1]) { tags = remaining[++i]; continue; }
    if (arg === "--description" && remaining[i + 1]) { description = remaining[++i]; continue; }
  }

  if (!name || !connectorType || !connectorConfig) {
    console.error("Usage: kweaver vega catalog create --name <name> --connector-type <type> --connector-config <json>");
    return 1;
  }

  const payload: Record<string, unknown> = {
    name,
    connector_type: connectorType,
    connector_config: JSON.parse(connectorConfig),
  };
  if (tags) payload.tags = tags.split(",");
  if (description) payload.description = description;

  const token = await ensureValidToken();
  const body = await createVegaCatalog({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog update
// ---------------------------------------------------------------------------

async function runCatalogUpdate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega catalog update <id> [options]

Options:
  --name <name>               Catalog name
  --tags <t1,t2>              Comma-separated tags
  --description <text>        Description
  --connector-config <json>   Connector config JSON`);
    return 0;
  }

  let name: string | undefined;
  let tags: string | undefined;
  let description: string | undefined;
  let connectorConfig: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--name" && remaining[i + 1]) { name = remaining[++i]; continue; }
    if (arg === "--tags" && remaining[i + 1]) { tags = remaining[++i]; continue; }
    if (arg === "--description" && remaining[i + 1]) { description = remaining[++i]; continue; }
    if (arg === "--connector-config" && remaining[i + 1]) { connectorConfig = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const id = positionals[0];
  if (!id) {
    console.error("Usage: kweaver vega catalog update <id> [--name X] [--tags X] [--description X] [--connector-config X]");
    return 1;
  }

  const payload: Record<string, unknown> = {};
  if (name) payload.name = name;
  if (tags) payload.tags = tags.split(",");
  if (description) payload.description = description;
  if (connectorConfig) payload.connector_config = JSON.parse(connectorConfig);

  const token = await ensureValidToken();
  const body = await updateVegaCatalog({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// catalog delete
// ---------------------------------------------------------------------------

async function runCatalogDelete(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega catalog delete <ids...> [-y]

Options:
  -y, --yes   Skip confirmation prompt`);
    return 0;
  }

  let yes = false;
  const { remaining, businessDomain } = parseCommonFlags(args);
  const positionals: string[] = [];

  for (const arg of remaining) {
    if (arg === "-y" || arg === "--yes") { yes = true; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  if (positionals.length === 0) {
    console.error("Usage: kweaver vega catalog delete <ids...> [-y]");
    return 1;
  }

  const ids = positionals.join(",");
  if (!yes) {
    const confirmed = await confirmYes(`Delete catalog(s) ${ids}?`);
    if (!confirmed) { console.error("Aborted."); return 1; }
  }

  const token = await ensureValidToken();
  await deleteVegaCatalogs({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    ids,
    businessDomain,
  });
  console.error(`Deleted ${ids}`);
  return 0;
}
```

- [ ] **Step 3: Update catalog help text**

In `runVegaCatalogCommand`, update the help text to include:

```typescript
console.log(`kweaver vega catalog

Subcommands:
  list [--status X] [--limit N] [--offset N]
  get <id>
  create --name <name> --connector-type <type> --connector-config <json> [--tags t1,t2] [--description X]
  update <id> [--name X] [--tags X] [--description X] [--connector-config X]
  delete <ids...> [-y]
  health <ids...> | --all
  test-connection <id>
  discover <id> [--wait]
  resources <id> [--category X] [--limit N]`);
```

- [ ] **Step 4: Update top-level vega help text**

In `printVegaHelp`, add the new catalog subcommands to the listing.

- [ ] **Step 5: Run tests**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/commands/vega.ts
git commit -m "feat(vega): add catalog create/update/delete CLI commands"
```

---

### Task 3: Resource CRUD — API Functions

**Files:**
- Modify: `packages/typescript/src/api/vega.ts`

- [ ] **Step 1: Write unit tests for resource create/update/delete**

Add to `packages/typescript/test/vega.test.ts`:

```typescript
test("createVegaResource sends POST to /resources with JSON body", async () => {
  const mock = mockFetch({ id: "new-res-1" }, 201);
  try {
    const client = makeClient();
    await client.vega.createResource(JSON.stringify({
      catalog_id: "cat-1",
      name: "test-res",
      category: "table",
    }));
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources");
  } finally {
    mock.restore();
  }
});

test("updateVegaResource sends PUT to /resources/:id", async () => {
  const mock = mockFetch("", 204);
  try {
    const client = makeClient();
    await client.vega.updateResource("res-1", JSON.stringify({ name: "updated" }));
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/res-1");
  } finally {
    mock.restore();
  }
});

test("deleteVegaResources sends DELETE to /resources/:ids", async () => {
  const mock = mockFetch("", 204);
  try {
    const client = makeClient();
    await client.vega.deleteResources("res-1,res-2");
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/res-1,res-2");
  } finally {
    mock.restore();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: FAIL

- [ ] **Step 3: Add API functions to `api/vega.ts`**

Insert after `queryVegaResourceData` (in the Resources section):

```typescript
export interface CreateVegaResourceOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function createVegaResource(options: CreateVegaResourceOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface UpdateVegaResourceOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  body: string;
  businessDomain?: string;
}

export async function updateVegaResource(options: UpdateVegaResourceOptions): Promise<string> {
  const { baseUrl, accessToken, id, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaResourcesOptions {
  baseUrl: string;
  accessToken: string;
  ids: string;
  businessDomain?: string;
}

export async function deleteVegaResources(options: DeleteVegaResourcesOptions): Promise<string> {
  const { baseUrl, accessToken, ids, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/resources/${ids}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}
```

- [ ] **Step 4: Add SDK wrapper methods to `resources/vega.ts`**

Add after `queryResourceData`:

```typescript
async createResource(body: string): Promise<unknown> {
  const raw = await createVegaResource({ ...this.ctx.base(), body });
  return JSON.parse(raw);
}

async updateResource(id: string, body: string): Promise<unknown> {
  const raw = await updateVegaResource({ ...this.ctx.base(), id, body });
  return raw ? JSON.parse(raw) : {};
}

async deleteResources(ids: string): Promise<unknown> {
  const raw = await deleteVegaResources({ ...this.ctx.base(), ids });
  return raw ? JSON.parse(raw) : {};
}
```

Update the import to include `createVegaResource`, `updateVegaResource`, `deleteVegaResources`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/api/vega.ts packages/typescript/src/resources/vega.ts packages/typescript/test/vega.test.ts
git commit -m "feat(vega): add resource create/update/delete API functions"
```

---

### Task 4: Resource CRUD — CLI Commands

**Files:**
- Modify: `packages/typescript/src/commands/vega.ts`

- [ ] **Step 1: Add resource create/update/delete imports and CLI handlers**

Add to the import block: `createVegaResource`, `updateVegaResource`, `deleteVegaResources`.

Add to `runVegaResourceCommand` dispatch:

```typescript
if (sub === "create") return await runResourceCreate(rest);
if (sub === "update") return await runResourceUpdate(rest);
if (sub === "delete") return await runResourceDelete(rest);
```

Add the handler functions after `runResourceQuery`:

```typescript
// ---------------------------------------------------------------------------
// resource create
// ---------------------------------------------------------------------------

async function runResourceCreate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega resource create [options]

Options:
  --catalog-id <cid>          Catalog ID (required)
  --name <name>               Resource name (required)
  --category <cat>            Category (required)
  --source-identifier <si>    Source identifier
  --database <db>             Database name
  -d, --data <json>           Additional fields as JSON`);
    return 0;
  }

  let catalogId: string | undefined;
  let name: string | undefined;
  let category: string | undefined;
  let sourceIdentifier: string | undefined;
  let database: string | undefined;
  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--catalog-id" && remaining[i + 1]) { catalogId = remaining[++i]; continue; }
    if (arg === "--name" && remaining[i + 1]) { name = remaining[++i]; continue; }
    if (arg === "--category" && remaining[i + 1]) { category = remaining[++i]; continue; }
    if (arg === "--source-identifier" && remaining[i + 1]) { sourceIdentifier = remaining[++i]; continue; }
    if (arg === "--database" && remaining[i + 1]) { database = remaining[++i]; continue; }
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
  }

  if (!catalogId || !name || !category) {
    console.error("Usage: kweaver vega resource create --catalog-id <cid> --name <name> --category <cat>");
    return 1;
  }

  const payload: Record<string, unknown> = { catalog_id: catalogId, name, category };
  if (sourceIdentifier) payload.source_identifier = sourceIdentifier;
  if (database) payload.database = database;
  if (data) Object.assign(payload, JSON.parse(data));

  const token = await ensureValidToken();
  const body = await createVegaResource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource update
// ---------------------------------------------------------------------------

async function runResourceUpdate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega resource update <id> [options]

Options:
  --name <name>       Resource name
  --status <s>        Status
  --tags <t1,t2>      Comma-separated tags
  -d, --data <json>   Additional fields as JSON`);
    return 0;
  }

  let name: string | undefined;
  let status: string | undefined;
  let tags: string | undefined;
  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--name" && remaining[i + 1]) { name = remaining[++i]; continue; }
    if (arg === "--status" && remaining[i + 1]) { status = remaining[++i]; continue; }
    if (arg === "--tags" && remaining[i + 1]) { tags = remaining[++i]; continue; }
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const id = positionals[0];
  if (!id) {
    console.error("Usage: kweaver vega resource update <id> [--name X] [--status X] [--tags X] [-d json]");
    return 1;
  }

  const payload: Record<string, unknown> = {};
  if (name) payload.name = name;
  if (status) payload.status = status;
  if (tags) payload.tags = tags.split(",");
  if (data) Object.assign(payload, JSON.parse(data));

  const token = await ensureValidToken();
  const body = await updateVegaResource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    body: JSON.stringify(payload),
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// resource delete
// ---------------------------------------------------------------------------

async function runResourceDelete(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega resource delete <ids...> [-y]

Options:
  -y, --yes   Skip confirmation prompt`);
    return 0;
  }

  let yes = false;
  const { remaining, businessDomain } = parseCommonFlags(args);
  const positionals: string[] = [];

  for (const arg of remaining) {
    if (arg === "-y" || arg === "--yes") { yes = true; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  if (positionals.length === 0) {
    console.error("Usage: kweaver vega resource delete <ids...> [-y]");
    return 1;
  }

  const ids = positionals.join(",");
  if (!yes) {
    const confirmed = await confirmYes(`Delete resource(s) ${ids}?`);
    if (!confirmed) { console.error("Aborted."); return 1; }
  }

  const token = await ensureValidToken();
  await deleteVegaResources({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    ids,
    businessDomain,
  });
  console.error(`Deleted ${ids}`);
  return 0;
}
```

- [ ] **Step 2: Update resource help text**

In `runVegaResourceCommand`, update help to include:

```typescript
console.log(`kweaver vega resource

Subcommands:
  list [--catalog-id X] [--category X] [--status X] [--limit N] [--offset N]
  get <id>
  create --catalog-id <cid> --name <name> --category <cat> [--source-identifier X] [--database X] [-d json]
  update <id> [--name X] [--status X] [--tags X] [-d json]
  delete <ids...> [-y]
  query <id> -d <json-body>`);
```

- [ ] **Step 3: Run tests**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/commands/vega.ts
git commit -m "feat(vega): add resource create/update/delete CLI commands"
```

---

### Task 5: Connector Type CRUD — API Functions

**Files:**
- Modify: `packages/typescript/src/api/vega.ts`

- [ ] **Step 1: Write unit tests for connector-type register/update/delete/enable**

Add to `packages/typescript/test/vega.test.ts`:

```typescript
test("registerVegaConnectorType sends POST to /connector-types", async () => {
  const mock = mockFetch({ type: "my-type" }, 201);
  try {
    const client = makeClient();
    await client.vega.registerConnectorType(JSON.stringify({ type: "my-type", name: "My Type", mode: "pull", category: "database" }));
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types");
  } finally {
    mock.restore();
  }
});

test("updateVegaConnectorType sends PUT to /connector-types/:type", async () => {
  const mock = mockFetch("", 204);
  try {
    const client = makeClient();
    await client.vega.updateConnectorType("my-type", JSON.stringify({ name: "Updated" }));
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types/my-type");
  } finally {
    mock.restore();
  }
});

test("deleteVegaConnectorType sends DELETE to /connector-types/:type", async () => {
  const mock = mockFetch("", 204);
  try {
    const client = makeClient();
    await client.vega.deleteConnectorType("my-type");
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types/my-type");
  } finally {
    mock.restore();
  }
});

test("setVegaConnectorTypeEnabled sends POST to /connector-types/:type/enabled", async () => {
  const mock = mockFetch("", 200);
  try {
    const client = makeClient();
    await client.vega.setConnectorTypeEnabled("my-type", true);
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types/my-type/enabled");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.enabled, true);
  } finally {
    mock.restore();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: FAIL

- [ ] **Step 3: Add API functions to `api/vega.ts`**

Insert after `getVegaConnectorType` (in the Connector Types section):

```typescript
export interface RegisterVegaConnectorTypeOptions {
  baseUrl: string;
  accessToken: string;
  body: string;
  businessDomain?: string;
}

export async function registerVegaConnectorType(options: RegisterVegaConnectorTypeOptions): Promise<string> {
  const { baseUrl, accessToken, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface UpdateVegaConnectorTypeOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  body: string;
  businessDomain?: string;
}

export async function updateVegaConnectorType(options: UpdateVegaConnectorTypeOptions): Promise<string> {
  const { baseUrl, accessToken, type, body: requestBody, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types/${encodeURIComponent(type)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: requestBody,
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface DeleteVegaConnectorTypeOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  businessDomain?: string;
}

export async function deleteVegaConnectorType(options: DeleteVegaConnectorTypeOptions): Promise<string> {
  const { baseUrl, accessToken, type, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types/${encodeURIComponent(type)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}

export interface SetVegaConnectorTypeEnabledOptions {
  baseUrl: string;
  accessToken: string;
  type: string;
  enabled: boolean;
  businessDomain?: string;
}

export async function setVegaConnectorTypeEnabled(options: SetVegaConnectorTypeEnabledOptions): Promise<string> {
  const { baseUrl, accessToken, type, enabled, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/connector-types/${encodeURIComponent(type)}/enabled`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}
```

- [ ] **Step 4: Add SDK wrapper methods to `resources/vega.ts`**

Add after `getConnectorType`:

```typescript
async registerConnectorType(body: string): Promise<unknown> {
  const raw = await registerVegaConnectorType({ ...this.ctx.base(), body });
  return JSON.parse(raw);
}

async updateConnectorType(type: string, body: string): Promise<unknown> {
  const raw = await updateVegaConnectorType({ ...this.ctx.base(), type, body });
  return raw ? JSON.parse(raw) : {};
}

async deleteConnectorType(type: string): Promise<unknown> {
  const raw = await deleteVegaConnectorType({ ...this.ctx.base(), type });
  return raw ? JSON.parse(raw) : {};
}

async setConnectorTypeEnabled(type: string, enabled: boolean): Promise<unknown> {
  const raw = await setVegaConnectorTypeEnabled({ ...this.ctx.base(), type, enabled });
  return raw ? JSON.parse(raw) : {};
}
```

Update the import to include `registerVegaConnectorType`, `updateVegaConnectorType`, `deleteVegaConnectorType`, `setVegaConnectorTypeEnabled`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/typescript/src/api/vega.ts packages/typescript/src/resources/vega.ts packages/typescript/test/vega.test.ts
git commit -m "feat(vega): add connector-type register/update/delete/enable API functions"
```

---

### Task 6: Connector Type CRUD — CLI Commands

**Files:**
- Modify: `packages/typescript/src/commands/vega.ts`

- [ ] **Step 1: Add connector-type CRUD imports and CLI handlers**

Add to the import block: `registerVegaConnectorType`, `updateVegaConnectorType`, `deleteVegaConnectorType`, `setVegaConnectorTypeEnabled`.

Add to `runVegaConnectorTypeCommand` dispatch:

```typescript
if (sub === "register") return await runConnectorTypeRegister(rest);
if (sub === "update") return await runConnectorTypeUpdate(rest);
if (sub === "delete") return await runConnectorTypeDelete(rest);
if (sub === "enable") return await runConnectorTypeEnable(rest);
```

Add the handler functions after `runConnectorTypeGet`:

```typescript
// ---------------------------------------------------------------------------
// connector-type register
// ---------------------------------------------------------------------------

async function runConnectorTypeRegister(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega connector-type register -d <json>

Options:
  -d, --data <json>   Connector type definition (JSON string)`);
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
  }

  if (!data) {
    console.error("Usage: kweaver vega connector-type register -d <json>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await registerVegaConnectorType({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type update
// ---------------------------------------------------------------------------

async function runConnectorTypeUpdate(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega connector-type update <type> -d <json>

Options:
  -d, --data <json>   Updated fields (JSON string)`);
    return 0;
  }

  let data: string | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if ((arg === "-d" || arg === "--data") && remaining[i + 1]) { data = remaining[++i]; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const type = positionals[0];
  if (!type || !data) {
    console.error("Usage: kweaver vega connector-type update <type> -d <json>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await updateVegaConnectorType({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    type,
    body: data,
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type delete
// ---------------------------------------------------------------------------

async function runConnectorTypeDelete(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega connector-type delete <type> [-y]

Options:
  -y, --yes   Skip confirmation prompt`);
    return 0;
  }

  let yes = false;
  const { remaining, businessDomain } = parseCommonFlags(args);
  const positionals: string[] = [];

  for (const arg of remaining) {
    if (arg === "-y" || arg === "--yes") { yes = true; continue; }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const type = positionals[0];
  if (!type) {
    console.error("Usage: kweaver vega connector-type delete <type> [-y]");
    return 1;
  }

  if (!yes) {
    const confirmed = await confirmYes(`Delete connector type "${type}"?`);
    if (!confirmed) { console.error("Aborted."); return 1; }
  }

  const token = await ensureValidToken();
  await deleteVegaConnectorType({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    type,
    businessDomain,
  });
  console.error(`Deleted ${type}`);
  return 0;
}

// ---------------------------------------------------------------------------
// connector-type enable
// ---------------------------------------------------------------------------

async function runConnectorTypeEnable(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega connector-type enable <type> --enabled <true|false>`);
    return 0;
  }

  let enabled: boolean | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  const positionals: string[] = [];
  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--enabled" && remaining[i + 1]) {
      enabled = remaining[++i] === "true";
      continue;
    }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const type = positionals[0];
  if (!type || enabled === undefined) {
    console.error("Usage: kweaver vega connector-type enable <type> --enabled <true|false>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await setVegaConnectorTypeEnabled({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    type,
    enabled,
    businessDomain,
  });
  console.log(formatCallOutput(body || "{}", pretty));
  return 0;
}
```

- [ ] **Step 2: Update connector-type help text**

In `runVegaConnectorTypeCommand`, update help:

```typescript
console.log(`kweaver vega connector-type

Subcommands:
  list                            List connector types
  get <type>                      Get connector type details
  register -d <json>              Register a new connector type
  update <type> -d <json>         Update connector type
  delete <type> [-y]              Delete connector type
  enable <type> --enabled <bool>  Enable/disable connector type`);
```

- [ ] **Step 3: Run tests**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/typescript/src/commands/vega.ts
git commit -m "feat(vega): add connector-type register/update/delete/enable CLI commands"
```

---

### Task 7: Discovery Task — API + CLI + SDK

**Files:**
- Modify: `packages/typescript/src/api/vega.ts`
- Modify: `packages/typescript/src/commands/vega.ts`
- Modify: `packages/typescript/src/resources/vega.ts`

- [ ] **Step 1: Write unit test for getVegaDiscoverTask**

Add to `packages/typescript/test/vega.test.ts`:

```typescript
test("getVegaDiscoverTask sends GET to /discover-tasks/:id", async () => {
  const mock = mockFetch({ id: "task-1", status: "completed" });
  try {
    const client = makeClient();
    await client.vega.getDiscoverTask("task-1");
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/discover-tasks/task-1");
  } finally {
    mock.restore();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: FAIL

- [ ] **Step 3: Add `getVegaDiscoverTask` API function to `api/vega.ts`**

Insert after `listVegaDiscoverTasks`:

```typescript
export interface GetVegaDiscoverTaskOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

export async function getVegaDiscoverTask(options: GetVegaDiscoverTaskOptions): Promise<string> {
  const { baseUrl, accessToken, id, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}${VEGA_BASE}/discover-tasks/${encodeURIComponent(id)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });

  const body = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, body);
  return body;
}
```

- [ ] **Step 4: Add SDK wrapper method to `resources/vega.ts`**

Add after `listDiscoverTasks`:

```typescript
async getDiscoverTask(id: string): Promise<unknown> {
  const raw = await getVegaDiscoverTask({ ...this.ctx.base(), id });
  return JSON.parse(raw);
}
```

Update the import to include `getVegaDiscoverTask`.

- [ ] **Step 5: Add `discovery-task` CLI router and handlers to `commands/vega.ts`**

Add to the import block: `getVegaDiscoverTask`.

Add to the main `dispatch` in `runVegaCommand`:

```typescript
if (subcommand === "discovery-task") return runVegaDiscoveryTaskCommand(rest);
```

Add the router and handlers at the end of the file:

```typescript
// ---------------------------------------------------------------------------
// Discovery-task router
// ---------------------------------------------------------------------------

async function runVegaDiscoveryTaskCommand(args: string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`kweaver vega discovery-task

Subcommands:
  list [--catalog-id X] [--status X] [--limit N]
  get <id>`);
    return 0;
  }

  if (sub === "list") return await runDiscoveryTaskList(rest);
  if (sub === "get") return await runDiscoveryTaskGet(rest);

  console.error(`Unknown discovery-task subcommand: ${sub}`);
  return 1;
}

// ---------------------------------------------------------------------------
// discovery-task list
// ---------------------------------------------------------------------------

async function runDiscoveryTaskList(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`kweaver vega discovery-task list [options]

Options:
  --catalog-id <cid>  Filter by catalog (not yet supported by API — reserved)
  --status <s>        Filter by status
  --limit <n>         Max results`);
    return 0;
  }

  let status: string | undefined;
  let limit: number | undefined;
  const { remaining, businessDomain, pretty } = parseCommonFlags(args);

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--status" && remaining[i + 1]) { status = remaining[++i]; continue; }
    if (arg === "--limit" && remaining[i + 1]) { limit = parseInt(remaining[++i], 10); continue; }
    // --catalog-id accepted but not used by current API
    if (arg === "--catalog-id" && remaining[i + 1]) { remaining[++i]; continue; }
  }

  const token = await ensureValidToken();
  const body = await listVegaDiscoverTasks({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    status,
    limit,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ---------------------------------------------------------------------------
// discovery-task get
// ---------------------------------------------------------------------------

async function runDiscoveryTaskGet(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("kweaver vega discovery-task get <id>");
    return 0;
  }

  const { remaining, businessDomain, pretty } = parseCommonFlags(args);
  const id = remaining.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: kweaver vega discovery-task get <id>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await getVegaDiscoverTask({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    businessDomain,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}
```

- [ ] **Step 6: Update top-level vega help text**

In `printVegaHelp`, add:

```
  discovery-task list [--status X] [--limit N]
  discovery-task get <id>
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/typescript/src/api/vega.ts packages/typescript/src/commands/vega.ts packages/typescript/src/resources/vega.ts packages/typescript/test/vega.test.ts
git commit -m "feat(vega): add discovery-task list/get commands"
```

---

### Task 8: E2E Tests — Read-Only + Help

**Files:**
- Modify: `packages/typescript/test/e2e/vega.test.ts`

- [ ] **Step 1: Add e2e tests for new help text and discovery-task commands**

Add to `packages/typescript/test/e2e/vega.test.ts`:

```typescript
test("e2e: vega catalog --help shows CRUD subcommands", async () => {
  const { code, stdout } = await runCli(["vega", "catalog", "--help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("create"));
  assert.ok(stdout.includes("update"));
  assert.ok(stdout.includes("delete"));
});

test("e2e: vega resource --help shows CRUD subcommands", async () => {
  const { code, stdout } = await runCli(["vega", "resource", "--help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("create"));
  assert.ok(stdout.includes("update"));
  assert.ok(stdout.includes("delete"));
});

test("e2e: vega connector-type --help shows CRUD subcommands", async () => {
  const { code, stdout } = await runCli(["vega", "connector-type", "--help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("register"));
  assert.ok(stdout.includes("update"));
  assert.ok(stdout.includes("delete"));
  assert.ok(stdout.includes("enable"));
});

test("e2e: vega discovery-task --help shows subcommands", async () => {
  const { code, stdout } = await runCli(["vega", "discovery-task", "--help"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("list"));
  assert.ok(stdout.includes("get"));
});

test("e2e: vega discovery-task list returns array", { skip: shouldSkipE2e() }, async () => {
  const { code, stdout } = await runCli(["vega", "discovery-task", "list"]);
  assert.equal(code, 0);
  const entries = extractEntries(JSON.parse(stdout));
  assert.ok(entries.length >= 0);
});
```

- [ ] **Step 2: Run e2e tests**

Run: `cd packages/typescript && npx tsx --test test/e2e/vega.test.ts`
Expected: PASS (help tests always pass; skip-gated tests run if `KWEAVER_BASE_URL` is set)

- [ ] **Step 3: Commit**

```bash
git add packages/typescript/test/e2e/vega.test.ts
git commit -m "test(vega): add e2e tests for new CRUD help text and discovery-task"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run all unit tests**

Run: `cd packages/typescript && npx tsx --test test/vega.test.ts`
Expected: All pass

- [ ] **Step 2: Run all e2e tests**

Run: `cd packages/typescript && npx tsx --test test/e2e/vega.test.ts`
Expected: All pass

- [ ] **Step 3: Verify CLI help output**

Run: `cd packages/typescript && npx tsx src/cli.ts vega --help`
Expected: Shows all 25 commands (13 existing + 12 new)

- [ ] **Step 4: TypeScript compile check**

Run: `cd packages/typescript && npx tsc --noEmit`
Expected: No errors
