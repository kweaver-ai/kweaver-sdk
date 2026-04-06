// ── State ────────────────────────────────────────────────────────────────────
let META = null;
const PAGE_SIZE = 30;
let navGeneration = 0; // incremented on each navigate() to cancel stale async work

// ── Cache ────────────────────────────────────────────────────────────────────
// instanceListCache: keyed by `${otId}::${searchAfterKey}` → { data, items, timestamp }
// instanceDetailCache: keyed by `${otId}::${pk}` → { instance, timestamp }
// subgraphCache: keyed by JSON body → { result, timestamp }
// searchCache: keyed by query → { data, timestamp }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const instanceListCache = {};
const instanceDetailCache = {};
const subgraphCache = {};
const searchCache = {};
const rtDetailCache = {}; // keyed by rtId → { results, timestamp }

function cacheKey(...parts) { return parts.join("::"); }
function isFresh(entry) { return entry && (Date.now() - entry.timestamp < CACHE_TTL); }

function clearAllCaches() {
  for (const k in instanceListCache) delete instanceListCache[k];
  for (const k in instanceDetailCache) delete instanceDetailCache[k];
  for (const k in subgraphCache) delete subgraphCache[k];
  for (const k in searchCache) delete searchCache[k];
  for (const k in rtDetailCache) delete rtDetailCache[k];
  META = null;
}

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, body) {
  const opts = body != null
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `API error: ${res.status}`;
    try {
      const err = await res.json();
      if (err.error) msg = err.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function loadMeta() {
  if (!META) META = await api("/api/meta");
  return META;
}

async function queryInstances(otId, opts = {}) {
  const body = { otId, limit: opts.limit ?? PAGE_SIZE };
  if (opts.searchAfter) body.search_after = opts.searchAfter;
  if (opts.condition) body.condition = opts.condition;
  if (opts._instance_identities) body._instance_identities = opts._instance_identities;
  return api("/api/instances", body);
}

async function queryInstancesCached(otId, opts = {}) {
  const key = cacheKey(otId, JSON.stringify(opts.searchAfter ?? "first"));
  if (isFresh(instanceListCache[key])) return instanceListCache[key].data;
  const data = await queryInstances(otId, opts);
  instanceListCache[key] = { data, timestamp: Date.now() };

  // Also cache each instance for detail view reuse
  const items = data.datas ?? data.entries ?? [];
  for (const item of items) {
    const identity = item._instance_identity ?? {};
    const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
    if (pk) instanceDetailCache[cacheKey(otId, pk)] = { instance: item, timestamp: Date.now() };
  }

  return data;
}

async function querySubgraph(body) {
  return api("/api/subgraph", body);
}

async function querySubgraphCached(body) {
  const key = JSON.stringify(body);
  if (isFresh(subgraphCache[key])) return subgraphCache[key].result;
  const result = await querySubgraph(body);
  subgraphCache[key] = { result, timestamp: Date.now() };
  return result;
}

async function search(query) {
  return api("/api/search", { query, maxConcepts: 30 });
}

async function searchCached(query) {
  if (isFresh(searchCache[query])) return searchCache[query].data;
  const data = await search(query);
  searchCache[query] = { data, timestamp: Date.now() };
  return data;
}

// ── Router ───────────────────────────────────────────────────────────────────
function getRoute() {
  const hash = location.hash.slice(1) || "/";
  if (hash === "/") return { view: "home" };
  const rtMatch = hash.match(/^\/rt\/(.+)$/);
  if (rtMatch) return { view: "rt", rtId: decodeURIComponent(rtMatch[1]) };
  const otMatch = hash.match(/^\/ot\/(.+)$/);
  if (otMatch) return { view: "ot", otId: decodeURIComponent(otMatch[1]) };
  const instanceMatch = hash.match(/^\/instance\/([^/]+)\/(.+)$/);
  if (instanceMatch) return { view: "instance", otId: decodeURIComponent(instanceMatch[1]), instanceId: decodeURIComponent(instanceMatch[2]) };
  const searchMatch = hash.match(/^\/search\?q=(.+)$/);
  if (searchMatch) return { view: "search", query: decodeURIComponent(searchMatch[1]) };
  return { view: "home" };
}

async function navigate() {
  const gen = ++navGeneration;
  const route = getRoute();
  const content = document.getElementById("content");
  content.innerHTML = '<div id="loading">加载中...</div>';
  try {
    if (route.view === "home") await renderHome(content, gen);
    else if (route.view === "rt") await renderRtDetail(content, route.rtId, gen);
    else if (route.view === "ot") await renderOtList(content, route.otId, gen);
    else if (route.view === "instance") await renderInstance(content, route.otId, route.instanceId, gen);
    else if (route.view === "search") await renderSearch(content, route.query, gen);
  } catch (err) {
    if (gen !== navGeneration) return; // stale render, discard
    console.error("navigate error:", err);
    content.innerHTML = `<div class="page-title">Error</div><p>${esc(err.message)}</p>`;
  }
}

function isStale(gen) { return gen !== navGeneration; }

// ── Renderers ────────────────────────────────────────────────────────────────
function renderHome(el) {
  const m = META;
  const otCount = m.objectTypes.length;
  const rtCount = m.relationTypes.length;

  el.innerHTML = `
    <h1 class="page-title">${esc(m.bkn.name)}</h1>
    <p class="page-subtitle">知识网络浏览器</p>

    <div class="stats-row">
      <div class="stat-card">
        <div class="number">${otCount}</div>
        <div class="label">对象类</div>
      </div>
      <div class="stat-card">
        <div class="number">${m.statistics.object_count || "—"}</div>
        <div class="label">实例总数</div>
      </div>
      <div class="stat-card">
        <div class="number">${rtCount}</div>
        <div class="label">关系类</div>
      </div>
      <div class="stat-card">
        <div class="number">${m.statistics.relation_count || "—"}</div>
        <div class="label">关系总数</div>
      </div>
    </div>

    <h2 style="font-size:18px; margin-bottom:16px;">对象类</h2>
    <div class="ot-grid">
      ${m.objectTypes.map(ot => `
        <a href="#/ot/${enc(ot.id)}" class="ot-card" style="text-decoration:none;color:inherit;">
          <h3>${esc(ot.name)}</h3>
          <div class="meta">${ot.propertyCount} 个属性</div>
        </a>
      `).join("")}
    </div>
  `;
}

// Per-OT user-chosen subtitle fields; null = use auto-detected
const userSubtitleFields = {};

async function renderOtList(el, otId) {
  const ot = META.objectTypes.find(o => o.id === otId);
  if (!ot) { el.innerHTML = "<p>未找到对象类</p>"; return; }

  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / ${esc(ot.name)}</div>
    <h1 class="page-title">${esc(ot.name)}</h1>
    <p class="page-subtitle">显示键: ${esc(ot.displayKey)} · ${ot.propertyCount} 个属性</p>
    <div id="field-picker"></div>
    <div id="instance-container"><div id="loading">加载实例...</div></div>
    <div id="pagination-container"></div>
  `;

  await loadInstances(otId, ot.displayKey);
}

// Cache current page items so field picker can re-render without re-fetching
let currentPageState = null;

async function loadInstances(otId, displayKey, searchAfter) {
  const data = await queryInstancesCached(otId, { searchAfter });
  const container = document.getElementById("instance-container");
  if (!container) return;
  const items = data.datas ?? data.entries ?? [];

  if (items.length === 0) {
    container.innerHTML = "<p style='padding:20px;color:#666;'>暂无实例</p>";
    return;
  }

  currentPageState = { otId, displayKey, items, searchAfter: data.search_after };

  // All available fields (non-internal, non-displayKey, with at least one non-empty value)
  const allFields = getAllFields(items, displayKey);
  const autoFields = pickSubtitleFields(items, displayKey);
  const activeFields = userSubtitleFields[otId] ?? autoFields;

  renderFieldPicker(otId, allFields, activeFields, autoFields);
  renderInstanceList(items, displayKey, activeFields, otId);

  const pag = document.getElementById("pagination-container");
  if (items.length >= PAGE_SIZE && data.search_after) {
    pag.innerHTML = `<div class="pagination"><button id="next-page">下一页</button></div>`;
    document.getElementById("next-page").onclick = () => loadInstances(otId, displayKey, data.search_after);
  } else {
    pag.innerHTML = "";
  }
}

function renderInstanceList(items, displayKey, subtitleFields, otId) {
  const container = document.getElementById("instance-container");
  container.innerHTML = `<div class="instance-list">
    ${items.map(item => {
      const identity = item._instance_identity ?? {};
      const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
      const name = item[displayKey] ?? Object.values(identity)[0] ?? "—";
      const subtitle = buildSubtitle(item, subtitleFields);
      return `<a href="#/instance/${enc(otId)}/${enc(pk)}" class="instance-item" style="display:block;text-decoration:none;color:inherit;">
        <div class="name">${esc(String(name))}</div>
        ${subtitle ? `<div class="instance-subtitle">${esc(subtitle)}</div>` : ""}
      </a>`;
    }).join("")}
  </div>`;
}

function getAllFields(items, displayKey) {
  const skip = new Set(["_instance_identity", "_object_type_id", "_score", "_instance_id", "_display", "id", displayKey]);
  const fields = new Set();
  for (const item of items) {
    for (const [k, v] of Object.entries(item)) {
      if (k.startsWith("_") || skip.has(k) || v == null || v === "") continue;
      fields.add(k);
    }
  }
  return [...fields];
}

function renderFieldPicker(otId, allFields, activeFields, autoFields) {
  const picker = document.getElementById("field-picker");
  if (allFields.length === 0) { picker.innerHTML = ""; return; }

  const activeSet = new Set(activeFields);
  picker.innerHTML = `
    <div class="field-picker">
      <span class="field-picker-label">副信息字段:</span>
      ${allFields.map(f =>
        `<button class="field-chip ${activeSet.has(f) ? "active" : ""}" data-field="${esc(f)}">${esc(f)}</button>`
      ).join("")}
      <button class="field-chip field-chip-auto" title="恢复自动推荐">自动</button>
    </div>
  `;

  picker.querySelectorAll(".field-chip[data-field]").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.field;
      let selected = userSubtitleFields[otId] ? [...userSubtitleFields[otId]] : [...activeFields];
      if (selected.includes(field)) {
        selected = selected.filter(f => f !== field);
      } else {
        selected.push(field);
      }
      userSubtitleFields[otId] = selected;
      renderFieldPicker(otId, allFields, selected, autoFields);
      renderInstanceList(currentPageState.items, currentPageState.displayKey, selected, otId);
    });
  });

  picker.querySelector(".field-chip-auto").addEventListener("click", () => {
    delete userSubtitleFields[otId];
    renderFieldPicker(otId, allFields, autoFields, autoFields);
    renderInstanceList(currentPageState.items, currentPageState.displayKey, autoFields, otId);
  });
}

async function renderInstance(el, otId, instanceId) {
  const ot = META.objectTypes.find(o => o.id === otId);
  if (!ot) { el.innerHTML = "<p>未找到对象类</p>"; return; }

  const identity = {};
  instanceId.split("&").forEach(pair => {
    const [k, ...rest] = pair.split("=");
    const raw = decodeURIComponent(rest.join("="));
    // Preserve numeric types for identity values
    const num = Number(raw);
    identity[decodeURIComponent(k)] = (raw !== "" && !isNaN(num)) ? num : raw;
  });

  // Try cache first (populated from list view)
  const pk = instanceId;
  const detailKey = cacheKey(otId, pk);
  let instance = null;
  if (isFresh(instanceDetailCache[detailKey])) {
    instance = instanceDetailCache[detailKey].instance;
  } else {
    const data = await queryInstances(otId, { _instance_identities: [identity], limit: 1 });
    const items = data.datas ?? data.entries ?? [];
    instance = items[0];
    if (instance) {
      instanceDetailCache[detailKey] = { instance, timestamp: Date.now() };
    }
  }

  if (!instance) {
    el.innerHTML = `<div class="breadcrumb"><a href="#/">首页</a> / <a href="#/ot/${enc(otId)}">${esc(ot.name)}</a></div><p>未找到实例</p>`;
    return;
  }

  const displayName = instance[ot.displayKey] ?? Object.values(identity)[0] ?? "—";
  const props = Object.entries(instance).filter(([k]) => !k.startsWith("_"));
  const propsHtml = props.map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${esc(formatValue(v))}</td></tr>`
  ).join("");

  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / <a href="#/ot/${enc(otId)}">${esc(ot.name)}</a> / ${esc(String(displayName))}</div>
    <h1 class="page-title">${esc(String(displayName))}</h1>
    <p class="page-subtitle">${esc(ot.name)}</p>

    <div class="detail-section">
      <h2>属性</h2>
      <table class="props-table">${propsHtml}</table>
    </div>

    <div class="detail-section" id="relations-section">
      <h2>关联</h2>
      <div id="relations-loading">加载关联...</div>
    </div>
  `;

  loadRelations(otId, instance);
}

async function loadRelations(otId, instance) {
  const container = document.getElementById("relations-loading");
  if (!container) return;
  const relatedRts = META.relationTypes.filter(
    rt => rt.sourceOtId === otId || rt.targetOtId === otId
  );

  if (relatedRts.length === 0) {
    container.innerHTML = "<p style='color:#666;'>无关联关系</p>";
    return;
  }

  let html = "";
  for (const rt of relatedRts) {
    const isSource = rt.sourceOtId === otId;
    const targetOtId = isSource ? rt.targetOtId : rt.sourceOtId;
    const targetOt = META.objectTypes.find(o => o.id === targetOtId);
    if (!targetOt) continue;

    try {
      const body = {
        relation_type_paths: [{
          object_types: [
            { id: otId, condition: buildInstanceCondition(instance), limit: 1 },
            { id: targetOtId, limit: 10 },
          ],
          relation_types: [{
            relation_type_id: rt.id,
            source_object_type_id: rt.sourceOtId,
            target_object_type_id: rt.targetOtId,
          }],
        }],
      };

      const result = await querySubgraphCached(body);
      const entries = result.entries ?? result.datas ?? [];

      if (entries.length === 0) continue;

      const links = extractLinkedInstances(entries, targetOtId, targetOt.displayKey);
      if (links.length === 0) continue;

      html += `<div class="relation-group">
        <h4>${esc(rt.name)} → ${esc(targetOt.name)}</h4>
        <div class="link-list">
          ${links.map(link =>
            `<a href="#/instance/${enc(targetOtId)}/${enc(link.pk)}" class="link-tag">${esc(link.name)}</a>`
          ).join("")}
        </div>
      </div>`;
    } catch {
      // Skip failed relation queries
    }
  }

  container.innerHTML = html || "<p style='color:#666;'>无关联实例</p>";
}

function extractLinkedInstances(entries, targetOtId, displayKey) {
  const results = [];
  const seen = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }

    if (obj._instance_identity) {
      const identity = obj._instance_identity;
      const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
      if (!seen.has(pk)) {
        seen.add(pk);
        const name = obj[displayKey] ?? Object.values(identity)[0] ?? "—";
        results.push({ pk, name: String(name) });
      }
    }

    for (const val of Object.values(obj)) {
      walk(val);
    }
  }

  walk(entries);
  return results;
}

async function renderSearch(el, query) {
  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / 搜索</div>
    <h1 class="page-title">搜索: ${esc(query)}</h1>
    <div id="search-results"><div id="loading">搜索中...</div></div>
  `;

  try {
    const data = await searchCached(query);
    const concepts = data.concepts ?? [];
    const container = document.getElementById("search-results");

    if (concepts.length === 0) {
      container.innerHTML = "<p style='color:#666;'>未找到结果</p>";
      return;
    }

    container.innerHTML = concepts.map(c => {
      const ot = META.objectTypes.find(o => o.id === c.concept_type || o.name === c.concept_type);
      const otId = ot ? ot.id : c.concept_type;
      const otName = ot ? ot.name : c.concept_type;
      const pk = c.concept_id ? `id=${c.concept_id}` : "";
      const href = pk ? `#/instance/${enc(otId)}/${enc(pk)}` : `#/ot/${enc(otId)}`;
      const score = (c.rerank_score ?? c.match_score ?? 0).toFixed(3);

      return `<a href="${href}" class="search-result" style="display:block;text-decoration:none;color:inherit;">
        <span class="score">${score}</span>
        <span class="type-badge">${esc(otName)}</span>
        <strong>${esc(c.concept_name)}</strong>
      </a>`;
    }).join("");
  } catch (err) {
    document.getElementById("search-results").innerHTML = `<p>搜索出错: ${esc(err.message)}</p>`;
  }
}

// ── Condition builder for subgraph queries ──────────────────────────────────
function buildInstanceCondition(instance) {
  const identity = instance._instance_identity ?? {};
  return {
    operation: "and",
    sub_conditions: Object.entries(identity).map(([field, value]) => ({
      field, operation: "==", value,
    })),
  };
}

// ── Relation type detail ────────────────────────────────────────────────────
async function renderRtDetail(el, rtId, gen) {
  const rt = META.relationTypes.find(r => r.id === rtId);
  if (!rt) { el.innerHTML = "<p>未找到关系类</p>"; return; }

  const sourceOt = META.objectTypes.find(o => o.id === rt.sourceOtId);
  const targetOt = META.objectTypes.find(o => o.id === rt.targetOtId);
  const srcName = sourceOt?.name ?? rt.sourceOtId;
  const tgtName = targetOt?.name ?? rt.targetOtId;
  const displayKey = sourceOt?.displayKey;

  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / ${esc(rt.name)}</div>
    <h1 class="page-title">${esc(rt.name)}</h1>
    <p class="page-subtitle">
      <a href="#/ot/${enc(rt.sourceOtId)}" style="color:var(--accent);text-decoration:none;">${esc(srcName)}</a>
      → <a href="#/ot/${enc(rt.targetOtId)}" style="color:var(--accent);text-decoration:none;">${esc(tgtName)}</a>
    </p>
    <div id="rt-instances"><div id="loading">加载关联...</div></div>
  `;

  // Use cached RT results if available
  let results;
  if (isFresh(rtDetailCache[rtId])) {
    results = rtDetailCache[rtId].results;
  } else {
    // Load source OT instances
    const data = await queryInstancesCached(rt.sourceOtId, {});
    if (isStale(gen)) return;
    const items = data.datas ?? data.entries ?? [];

    if (items.length === 0) {
      const c = document.getElementById("rt-instances");
      if (c) c.innerHTML = "<p style='padding:20px;color:#666;'>暂无实例</p>";
      return;
    }

    // Batch-query relations (3 concurrent, with cancellation)
    results = [];
    const BATCH = 3;
    for (let i = 0; i < items.length; i += BATCH) {
      if (isStale(gen)) return; // user navigated away, stop querying
      const batch = items.slice(i, i + BATCH);
      const promises = batch.map(async (item) => {
        try {
          const body = {
            relation_type_paths: [{
              object_types: [
                { id: rt.sourceOtId, condition: buildInstanceCondition(item), limit: 1 },
                { id: rt.targetOtId, limit: 20 },
              ],
              relation_types: [{
                relation_type_id: rt.id,
                source_object_type_id: rt.sourceOtId,
                target_object_type_id: rt.targetOtId,
              }],
            }],
          };
          const result = await querySubgraphCached(body);
          const entries = result.entries ?? result.datas ?? [];
          const links = extractLinkedInstances(entries, rt.targetOtId, targetOt?.displayKey);
          return { sourceItem: item, links };
        } catch {
          return { sourceItem: item, links: [] };
        }
      });
      results.push(...(await Promise.all(promises)));
    }

    if (isStale(gen)) return;
    rtDetailCache[rtId] = { results, timestamp: Date.now() };
  }

  // Render
  const container = document.getElementById("rt-instances");
  if (!container) return;

  const withLinks = results.filter(r => r.links.length > 0);
  const withoutLinks = results.filter(r => r.links.length === 0);

  let html = "";

  if (withLinks.length > 0) {
    html += `<div class="instance-list">
      ${withLinks.map(r => {
        const identity = r.sourceItem._instance_identity ?? {};
        const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
        const name = (displayKey && r.sourceItem[displayKey]) ?? Object.values(identity)[0] ?? "—";
        return `<div class="rt-source-item">
          <div class="rt-source-header">
            <a href="#/instance/${enc(rt.sourceOtId)}/${enc(pk)}" class="name">${esc(String(name))}</a>
            <span class="rt-link-count">${r.links.length} 个关联</span>
          </div>
          <div class="rt-targets" style="display:block;">
            <div class="link-list">
              ${r.links.map(link =>
                `<a href="#/instance/${enc(rt.targetOtId)}/${enc(link.pk)}" class="link-tag">${esc(link.name)}</a>`
              ).join("")}
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  } else {
    html += `<p style="padding:20px;color:#666;">该关系类下暂无关联实例</p>`;
  }

  if (withoutLinks.length > 0) {
    html += `<details class="rt-no-links-section">
      <summary>${withoutLinks.length} 个${srcName}实例无关联</summary>
      <div class="rt-no-links-list">
        ${withoutLinks.map(r => {
          const identity = r.sourceItem._instance_identity ?? {};
          const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
          const name = (displayKey && r.sourceItem[displayKey]) ?? Object.values(identity)[0] ?? "—";
          return `<a href="#/instance/${enc(rt.sourceOtId)}/${enc(pk)}" class="rt-no-link-item">${esc(String(name))}</a>`;
        }).join("")}
      </div>
    </details>`;
  }

  container.innerHTML = html;
}

// ── Subtitle builder ────────────────────────────────────────────────────────
// Pick the top-N most distinguishing fields from a page of instances.
// Uses unique-value count as a proxy for "discriminating power" —
// no hardcoded field names, works for any domain.
function pickSubtitleFields(items, displayKey, topN = 3) {
  const skip = new Set(["_instance_identity", "_object_type_id", "_score", "_instance_id", "_display", "id", displayKey]);
  // Collect unique values per field across all items
  const fieldValues = {};  // field -> Set of values
  for (const item of items) {
    for (const [k, v] of Object.entries(item)) {
      if (k.startsWith("_") || skip.has(k) || v == null || v === "") continue;
      const str = formatValue(v);
      if (str.length > 50) continue;
      if (!fieldValues[k]) fieldValues[k] = new Set();
      fieldValues[k].add(str);
    }
  }
  // Sort by number of unique values (descending) — more unique = more distinguishing
  return Object.entries(fieldValues)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, topN)
    .map(([k]) => k);
}

function buildSubtitle(item, subtitleFields) {
  return subtitleFields
    .filter(k => item[k] != null && item[k] !== "")
    .map(k => `${k}: ${formatValue(item[k])}`)
    .join(" · ");
}

// ── Utilities ────────────────────────────────────────────────────────────────
function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function enc(s) {
  return encodeURIComponent(s);
}

function formatValue(v) {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const otList = document.getElementById("nav-ot-list");
  otList.innerHTML = META.objectTypes.map(ot =>
    `<li><a href="#/ot/${enc(ot.id)}">${esc(ot.name)}</a></li>`
  ).join("");

  const rtList = document.getElementById("nav-rt-list");
  rtList.innerHTML = META.relationTypes.map(rt =>
    `<li><a href="#/rt/${enc(rt.id)}" class="rt-nav-item"><span class="rt-icon">&#x21C4;</span>${esc(rt.sourceOtName)} → ${esc(rt.targetOtName)}</a></li>`
  ).join("");
}

// ── Search binding ───────────────────────────────────────────────────────────
function bindSearch() {
  const input = document.getElementById("search-input");
  const btn = document.getElementById("search-btn");

  function doSearch() {
    const q = input.value.trim();
    if (q) location.hash = `/search?q=${encodeURIComponent(q)}`;
  }

  btn.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
}

// ── Hard refresh ─────────────────────────────────────────────────────────────
function bindRefresh() {
  document.getElementById("refresh-btn").addEventListener("click", async () => {
    const btn = document.getElementById("refresh-btn");
    btn.classList.add("spinning");
    btn.disabled = true;
    clearAllCaches();
    await loadMeta();
    renderSidebar();
    await navigate();
    btn.classList.remove("spinning");
    btn.disabled = false;
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadMeta();
  document.title = `${META.bkn.name} — BKN Explorer`;
  renderSidebar();
  bindSearch();
  bindRefresh();
  window.addEventListener("hashchange", navigate);
  navigate();
}

init();
