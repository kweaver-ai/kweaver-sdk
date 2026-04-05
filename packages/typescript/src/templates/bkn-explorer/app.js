// ── State ────────────────────────────────────────────────────────────────────
let META = null;
const PAGE_SIZE = 30;

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, body) {
  const opts = body != null
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function loadMeta() {
  META = await api("/api/meta");
  return META;
}

async function queryInstances(otId, opts = {}) {
  return api("/api/instances", { otId, limit: opts.limit ?? PAGE_SIZE, search_after: opts.searchAfter, condition: opts.condition });
}

async function querySubgraph(body) {
  return api("/api/subgraph", body);
}

async function search(query) {
  return api("/api/search", { query, maxConcepts: 30 });
}

// ── Router ───────────────────────────────────────────────────────────────────
function getRoute() {
  const hash = location.hash.slice(1) || "/";
  if (hash === "/") return { view: "home" };
  const otMatch = hash.match(/^\/ot\/(.+)$/);
  if (otMatch) return { view: "ot", otId: decodeURIComponent(otMatch[1]) };
  const instanceMatch = hash.match(/^\/instance\/([^/]+)\/(.+)$/);
  if (instanceMatch) return { view: "instance", otId: decodeURIComponent(instanceMatch[1]), instanceId: decodeURIComponent(instanceMatch[2]) };
  const searchMatch = hash.match(/^\/search\?q=(.+)$/);
  if (searchMatch) return { view: "search", query: decodeURIComponent(searchMatch[1]) };
  return { view: "home" };
}

async function navigate() {
  const route = getRoute();
  const content = document.getElementById("content");
  content.innerHTML = '<div id="loading">加载中...</div>';
  try {
    if (route.view === "home") await renderHome(content);
    else if (route.view === "ot") await renderOtList(content, route.otId);
    else if (route.view === "instance") await renderInstance(content, route.otId, route.instanceId);
    else if (route.view === "search") await renderSearch(content, route.query);
  } catch (err) {
    content.innerHTML = `<div class="page-title">Error</div><p>${esc(err.message)}</p>`;
  }
}

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

async function renderOtList(el, otId) {
  const ot = META.objectTypes.find(o => o.id === otId);
  if (!ot) { el.innerHTML = "<p>未找到对象类</p>"; return; }

  el.innerHTML = `
    <div class="breadcrumb"><a href="#/">首页</a> / ${esc(ot.name)}</div>
    <h1 class="page-title">${esc(ot.name)}</h1>
    <p class="page-subtitle">显示键: ${esc(ot.displayKey)} · ${ot.propertyCount} 个属性</p>
    <div id="instance-container"><div id="loading">加载实例...</div></div>
    <div id="pagination-container"></div>
  `;

  await loadInstances(otId, ot.displayKey);
}

async function loadInstances(otId, displayKey, searchAfter) {
  const data = await queryInstances(otId, { searchAfter });
  const container = document.getElementById("instance-container");
  const items = data.datas ?? data.entries ?? [];

  if (items.length === 0) {
    container.innerHTML = "<p style='padding:20px;color:#666;'>暂无实例</p>";
    return;
  }

  container.innerHTML = `<div class="instance-list">
    ${items.map(item => {
      const identity = item._instance_identity ?? {};
      const pk = Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("&");
      const name = item[displayKey] ?? Object.values(identity)[0] ?? "—";
      return `<a href="#/instance/${enc(otId)}/${enc(pk)}" class="instance-item" style="display:block;text-decoration:none;color:inherit;">
        <div class="name">${esc(String(name))}</div>
      </a>`;
    }).join("")}
  </div>`;

  const pag = document.getElementById("pagination-container");
  if (items.length >= PAGE_SIZE && data.search_after) {
    pag.innerHTML = `<div class="pagination"><button id="next-page">下一页</button></div>`;
    document.getElementById("next-page").onclick = () => loadInstances(otId, displayKey, data.search_after);
  } else {
    pag.innerHTML = "";
  }
}

async function renderInstance(el, otId, instanceId) {
  const ot = META.objectTypes.find(o => o.id === otId);
  if (!ot) { el.innerHTML = "<p>未找到对象类</p>"; return; }

  const identity = {};
  instanceId.split("&").forEach(pair => {
    const [k, ...rest] = pair.split("=");
    identity[decodeURIComponent(k)] = decodeURIComponent(rest.join("="));
  });

  const condition = {
    operation: "and",
    sub_conditions: Object.entries(identity).map(([field, value]) => ({
      field, operation: "eq", value_from: "const", value,
    })),
  };

  const data = await queryInstances(otId, { condition, limit: 1 });
  const items = data.datas ?? data.entries ?? [];
  const instance = items[0];

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

  loadRelations(otId, identity);
}

async function loadRelations(otId, identity) {
  const container = document.getElementById("relations-loading");
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
            { id: otId, condition: { operation: "and", sub_conditions: Object.entries(identity).map(([field, value]) => ({ field, operation: "eq", value_from: "const", value })) }, limit: 1 },
            { id: targetOtId, limit: 10 },
          ],
          relation_types: [{
            relation_type_id: rt.id,
            source_object_type_id: rt.sourceOtId,
            target_object_type_id: rt.targetOtId,
          }],
        }],
      };

      const result = await querySubgraph(body);
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
    const data = await search(query);
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
    `<li><a href="#" style="cursor:default;color:var(--text-secondary);">${esc(rt.name)}<br><small>${esc(rt.sourceOtName)} → ${esc(rt.targetOtName)}</small></a></li>`
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

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadMeta();
  document.title = `${META.bkn.name} — BKN Explorer`;
  renderSidebar();
  bindSearch();
  window.addEventListener("hashchange", navigate);
  navigate();
}

init();
