// ── Vega Tab ─────────────────────────────────────────────────────────────────

// Caches
const vegaCatalogCache = {};
const vegaResourcesCache = {};
const vegaTasksCache = {};
const vegaDataCache = {};

// ── API wrappers ──────────────────────────────────────────────────────────────

async function vegaLoadCatalogs() {
  return cachedFetch(vegaCatalogCache, "all", () => api("GET", "/api/vega/catalogs"));
}

async function vegaLoadResources(catalogId) {
  return cachedFetch(vegaResourcesCache, catalogId, () =>
    api("GET", `/api/vega/catalog-resources?catalogId=${enc(catalogId)}`),
  );
}

async function vegaLoadTasks() {
  return cachedFetch(vegaTasksCache, "all", () => api("GET", "/api/vega/tasks"));
}

async function vegaQueryData(resourceId, query) {
  const key = `${resourceId}::${JSON.stringify(query ?? {})}`;
  return cachedFetch(vegaDataCache, key, () =>
    api("POST", "/api/vega/query", { resourceId, query: query ?? {} }),
  );
}

// ── Health indicator ──────────────────────────────────────────────────────────

function vegaHealthDot(status) {
  if (!status) return '<span title="Unknown">⚪</span>';
  const s = String(status).toLowerCase();
  if (s === "healthy" || s === "ok" || s === "active") return '<span title="Healthy">🟢</span>';
  if (s === "unhealthy" || s === "error" || s === "failed") return '<span title="Unhealthy">🔴</span>';
  return `<span title="${esc(status)}">⚪</span>`;
}

function vegaGetHealth(health, catalogId) {
  if (!health || health.error) return null;
  // health may be an object keyed by catalog id, or an array of { id, status } items
  if (Array.isArray(health)) {
    const entry = health.find(h => h.id === catalogId || h.catalog_id === catalogId);
    return entry ? (entry.status ?? entry.health_status ?? null) : null;
  }
  if (typeof health === "object") {
    const entry = health[catalogId];
    if (entry && typeof entry === "object") return entry.status ?? entry.health_status ?? null;
    if (typeof entry === "string") return entry;
    // Try nested data / entries
    const items = health.data ?? health.entries ?? health.items;
    if (Array.isArray(items)) {
      const found = items.find(h => h.id === catalogId || h.catalog_id === catalogId);
      return found ? (found.status ?? found.health_status ?? null) : null;
    }
  }
  return null;
}

// ── Catalog list view ─────────────────────────────────────────────────────────

function vegaRenderCatalogList($el, data) {
  const { catalogs, health } = data;
  const items = extractList(catalogs);

  if (items.length === 0) {
    $el.innerHTML = `
      <div class="section-header"><h2>Vega Catalogs</h2></div>
      <div class="empty-state">No catalogs found.</div>`;
    return;
  }

  const cards = items.map(cat => {
    const healthStatus = vegaGetHealth(health, cat.id);
    const dot = vegaHealthDot(healthStatus);
    const name = esc(cat.name ?? cat.id);
    const id = esc(cat.id);
    const connType = esc(cat.connector_type ?? cat.type ?? "—");
    const statusLabel = esc(cat.status ?? "");
    return `
      <div class="card" style="cursor:pointer" onclick="location.hash='/vega/${enc(cat.id)}'">
        <div class="card-title">${dot} ${name}</div>
        <div class="card-meta">ID: ${id}</div>
        <div class="card-meta">Connector: ${connType}</div>
        ${statusLabel ? `<div class="card-meta">Status: ${statusLabel}</div>` : ""}
      </div>`;
  });

  $el.innerHTML = `
    <div class="section-header"><h2>Vega Catalogs <span class="count">(${items.length})</span></h2></div>
    <div class="card-grid">${cards.join("")}</div>
    <div id="vega-tasks-section"></div>`;

  // Render discover tasks in the same view
  vegaRenderTasksSection(document.getElementById("vega-tasks-section"));
}

async function vegaRenderTasksSection($el) {
  if (!$el) return;
  let tasksData;
  try {
    tasksData = await vegaLoadTasks();
  } catch {
    return; // silently ignore tasks errors on catalog list
  }
  const tasks = extractList(tasksData);
  if (tasks.length === 0) return;

  const activeTasks = tasks.filter(t => {
    const s = (t.status ?? "").toLowerCase();
    return s === "running" || s === "pending" || s === "in_progress";
  });

  if (activeTasks.length === 0) return;

  const rows = activeTasks.map(t => `
    <tr>
      <td>${esc(t.id)}</td>
      <td>${esc(t.catalog_id ?? "—")}</td>
      <td>${esc(t.status ?? "—")}</td>
      <td>${esc(t.created_at ?? t.start_time ?? "—")}</td>
    </tr>`).join("");

  $el.innerHTML = `
    <div class="section-header" style="margin-top:2rem">
      <h3>Active Discover Tasks <span class="count">(${activeTasks.length})</span></h3>
    </div>
    <table>
      <thead><tr><th>Task ID</th><th>Catalog ID</th><th>Status</th><th>Started</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Resource list view ────────────────────────────────────────────────────────

function vegaRenderResourceList($el, catalogId, data) {
  const items = extractList(data);

  const breadcrumb = `
    <div class="breadcrumb">
      <a href="#/vega">Catalogs</a> / <strong>${esc(catalogId)}</strong>
    </div>`;

  if (items.length === 0) {
    $el.innerHTML = `${breadcrumb}
      <div class="section-header"><h2>Resources</h2></div>
      <div class="empty-state">No resources found in this catalog.</div>`;
    return;
  }

  const rows = items.map(r => {
    const name = esc(r.name ?? r.id);
    const rtype = esc(r.category ?? r.type ?? r.resource_type ?? "—");
    const fields = r.schema?.fields?.length ?? r.fields?.length ?? r.field_count ?? "—";
    return `
      <tr style="cursor:pointer" onclick="location.hash='/vega/${enc(catalogId)}/${enc(r.id)}'">
        <td>${name}</td>
        <td>${esc(r.id)}</td>
        <td>${rtype}</td>
        <td>${esc(String(fields))}</td>
      </tr>`;
  });

  $el.innerHTML = `
    ${breadcrumb}
    <div class="section-header"><h2>Resources <span class="count">(${items.length})</span></h2></div>
    <table>
      <thead><tr><th>Name</th><th>ID</th><th>Type</th><th>Fields</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

// ── Resource detail / data preview ───────────────────────────────────────────

function vegaRenderSchema(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return "";
  const rows = fields.map(f => `
    <tr>
      <td>${esc(f.name ?? f.field_name ?? "—")}</td>
      <td>${esc(f.type ?? f.data_type ?? "—")}</td>
      <td>${esc(f.description ?? "")}</td>
    </tr>`).join("");
  return `
    <div class="section-header" style="margin-top:1.5rem"><h3>Schema Fields <span class="count">(${fields.length})</span></h3></div>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function vegaRenderDataPreview(rawData, fields) {
  let rows = [];
  if (Array.isArray(rawData)) {
    rows = rawData;
  } else if (rawData && typeof rawData === "object") {
    rows = rawData.data ?? rawData.entries ?? rawData.rows ?? rawData.items ?? [];
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<div class="empty-state">No data rows available.</div>';
  }

  const preview = rows.slice(0, 20);

  // Determine columns: from schema fields or from first row keys
  let cols;
  if (Array.isArray(fields) && fields.length > 0) {
    cols = fields.map(f => f.name ?? f.field_name).filter(Boolean);
  } else if (typeof preview[0] === "object" && preview[0] !== null) {
    cols = Object.keys(preview[0]);
  } else {
    cols = ["value"];
  }

  const headers = cols.map(c => `<th>${esc(c)}</th>`).join("");
  const dataRows = preview.map(row => {
    const cells = cols.map(c => {
      const v = typeof row === "object" && row !== null ? row[c] : row;
      return `<td>${formatValue(v)}</td>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  }).join("");

  return `
    <div class="section-header" style="margin-top:1.5rem">
      <h3>Data Preview <span class="count">(first ${preview.length} rows)</span></h3>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${dataRows}</tbody>
      </table>
    </div>`;
}

async function vegaRenderResourceDetail($el, catalogId, resourceId) {
  const breadcrumb = `
    <div class="breadcrumb">
      <a href="#/vega">Catalogs</a> /
      <a href="#/vega/${enc(catalogId)}">${esc(catalogId)}</a> /
      <strong>${esc(resourceId)}</strong>
    </div>`;

  $el.innerHTML = `${breadcrumb}<div class="loading">Loading resource data...</div>`;

  // Load resources list to get schema for this resource
  let schemaFields = [];
  try {
    const resourcesData = await vegaLoadResources(catalogId);
    const items = extractList(resourcesData);
    const res = items.find(r => r.id === resourceId);
    if (res) {
      schemaFields = res.schema?.fields ?? res.fields ?? [];
    }
  } catch { /* schema is best-effort */ }

  // Query first 20 rows
  let dataPreviewHtml = "";
  try {
    const rawData = await vegaQueryData(resourceId, { limit: 20 });
    dataPreviewHtml = vegaRenderDataPreview(rawData, schemaFields);
  } catch (e) {
    dataPreviewHtml = `<div class="error-banner">Failed to load data: ${esc(String(e))}</div>`;
  }

  $el.innerHTML = `
    ${breadcrumb}
    <div class="section-header"><h2>${esc(resourceId)}</h2></div>
    ${vegaRenderSchema(schemaFields)}
    ${dataPreviewHtml}`;
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

async function renderVega($el, parts, _params) {
  const myGen = navGeneration;

  // parts = []              → catalog list + discover tasks
  // parts = [catalogId]     → resources in that catalog
  // parts = [catalogId, resourceId] → resource detail + data preview

  if (parts.length === 0) {
    $el.innerHTML = '<div class="loading">Loading Vega catalogs...</div>';
    try {
      const data = await vegaLoadCatalogs();
      if (navGeneration !== myGen) return;
      vegaRenderCatalogList($el, data);
    } catch (e) {
      if (navGeneration !== myGen) return;
      $el.innerHTML = `<div class="error-banner">Failed to load catalogs: ${esc(String(e))}</div>`;
    }
    return;
  }

  const [catalogId, resourceId] = parts;

  if (!resourceId) {
    $el.innerHTML = '<div class="loading">Loading resources...</div>';
    try {
      const data = await vegaLoadResources(catalogId);
      if (navGeneration !== myGen) return;
      vegaRenderResourceList($el, catalogId, data);
    } catch (e) {
      if (navGeneration !== myGen) return;
      $el.innerHTML = `<div class="error-banner">Failed to load resources: ${esc(String(e))}</div>`;
    }
    return;
  }

  // Resource detail
  await vegaRenderResourceDetail($el, catalogId, resourceId);
}
