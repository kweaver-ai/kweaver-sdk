// ── BKN Tab ─────────────────────────────────────────────────────────────────

// BKN-specific state
let bknMeta = null;
let bknCurrentKnId = null;
const PAGE_SIZE = 30;

// Caches
const instanceListCache = {};
const instanceDetailCache = {};
const subgraphCache = {};
const bknSearchCache = {};
const rtDetailCache = {};

function bknCacheKey(...parts) { return parts.join("::"); }
function bknIsFresh(entry) { return entry && (Date.now() - entry.timestamp < CACHE_TTL); }

function clearBknCaches() {
  for (const k in instanceListCache) delete instanceListCache[k];
  for (const k in instanceDetailCache) delete instanceDetailCache[k];
  for (const k in subgraphCache) delete subgraphCache[k];
  for (const k in bknSearchCache) delete bknSearchCache[k];
  for (const k in rtDetailCache) delete rtDetailCache[k];
  bknMeta = null;
  bknCurrentKnId = null;
}

// Per-OT user-chosen subtitle fields; null = use auto-detected
const userSubtitleFields = {};
let currentPageState = null;

// ── API wrappers ────────────────────────────────────────────────────────────

async function loadBknForKn(knId) {
  if (bknCurrentKnId === knId && bknMeta) return bknMeta;
  // Tell server to load this KN's data
  try {
    await api("POST", "/api/bkn/load", { knId });
  } catch (e) {
    // /api/bkn/load may not exist yet (added in Task 7);
    // fall through and try loading meta directly
  }
  bknMeta = await api("GET", "/api/bkn/meta");
  bknCurrentKnId = knId;
  return bknMeta;
}

async function bknQueryInstances(otId, opts) {
  if (!opts) opts = {};
  const body = { otId, limit: opts.limit ?? PAGE_SIZE };
  if (opts.searchAfter) body.search_after = opts.searchAfter;
  if (opts.condition) body.condition = opts.condition;
  if (opts._instance_identities) body._instance_identities = opts._instance_identities;
  return api("POST", "/api/bkn/instances", body);
}

async function bknQueryInstancesCached(otId, opts) {
  if (!opts) opts = {};
  const key = bknCacheKey(otId, JSON.stringify(opts.searchAfter ?? "first"));
  if (bknIsFresh(instanceListCache[key])) return instanceListCache[key].data;
  const data = await bknQueryInstances(otId, opts);
  instanceListCache[key] = { data, timestamp: Date.now() };

  // Also cache each instance for detail view reuse
  const items = data.datas ?? data.entries ?? [];
  for (const item of items) {
    const identity = item._instance_identity ?? {};
    const pk = Object.entries(identity).map(([k, v]) => `${k}=${v}`).join("&");
    if (pk) instanceDetailCache[bknCacheKey(otId, pk)] = { instance: item, timestamp: Date.now() };
  }

  return data;
}

async function bknQuerySubgraph(body) {
  return api("POST", "/api/bkn/subgraph", body);
}

async function bknQuerySubgraphCached(body) {
  const key = JSON.stringify(body);
  if (bknIsFresh(subgraphCache[key])) return subgraphCache[key].result;
  const result = await bknQuerySubgraph(body);
  subgraphCache[key] = { result, timestamp: Date.now() };
  return result;
}

async function bknSearch(query) {
  return api("POST", "/api/bkn/search", { query, maxConcepts: 30 });
}

async function bknSearchCached(query) {
  if (bknIsFresh(bknSearchCache[query])) return bknSearchCache[query].data;
  const data = await bknSearch(query);
  bknSearchCache[query] = { data, timestamp: Date.now() };
  return data;
}

// ── Main dispatcher ─────────────────────────────────────────────────────────

async function renderBkn($el, parts, params) {
  const gen = navGeneration;

  if (parts.length === 0) {
    // KN selection list
    return renderBknKnList($el, gen);
  }

  const knId = parts[0];
  const subParts = parts.slice(1);

  // Load BKN meta for this KN
  try {
    $el.innerHTML = '<div class="loading">Loading knowledge network...</div>';
    await loadBknForKn(knId);
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load KN: ' + esc(String(err.message || err)) + '</div>';
    return;
  }
  if (navGeneration !== gen) return;

  if (subParts.length === 0) {
    renderBknHome($el, knId);
  } else if (subParts[0] === "ot" && subParts[1]) {
    await renderBknOtList($el, knId, decodeURIComponent(subParts[1]), gen);
  } else if (subParts[0] === "instance" && subParts[1] && subParts[2]) {
    await renderBknInstance($el, knId, decodeURIComponent(subParts[1]), decodeURIComponent(subParts[2]), gen);
  } else if (subParts[0] === "search") {
    await renderBknSearchView($el, knId, params.get("q") || "", gen);
  } else if (subParts[0] === "rt" && subParts[1]) {
    await renderBknRtDetail($el, knId, decodeURIComponent(subParts[1]), gen);
  } else {
    $el.innerHTML = '<div class="error-banner">Unknown BKN route</div>';
  }
}

// ── KN list view (NEW) ─────────────────────────────────────────────────────

async function renderBknKnList($el, gen) {
  $el.innerHTML = '<div class="loading">Loading knowledge networks...</div>';

  let data;
  try {
    data = await cachedFetch(bknSearchCache, "__kn_list__", () => api("GET", "/api/dashboard"));
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load knowledge networks. <a href="#/bkn" onclick="location.reload()">Retry</a></div>';
    return;
  }
  if (navGeneration !== gen) return;

  const knList = extractList(data.kn);

  if (knList.length === 0) {
    $el.innerHTML = '<div class="breadcrumb"><a href="#/">Home</a> / BKN</div>' +
      '<h1 class="page-title">Knowledge Networks</h1>' +
      '<p style="padding:20px;color:#666;">No knowledge networks found.</p>';
    return;
  }

  $el.innerHTML = '<div class="breadcrumb"><a href="#/">Home</a> / BKN</div>' +
    '<h1 class="page-title">Knowledge Networks</h1>' +
    '<p class="page-subtitle">' + knList.length + ' knowledge network(s) available</p>' +
    '<div class="ot-grid">' +
      knList.map(function(kn) {
        var id = kn.id || kn.kg_id;
        var name = kn.name || kn.kg_name || id;
        var desc = kn.description || "";
        return '<a href="#/bkn/' + enc(id) + '" class="ot-card" style="text-decoration:none;color:inherit;">' +
          '<h3>' + esc(name) + '</h3>' +
          (desc ? '<div class="meta">' + esc(desc) + '</div>' : '') +
        '</a>';
      }).join("") +
    '</div>';
}

// ── BKN Home (schema overview for a KN) ─────────────────────────────────────

function renderBknHome($el, knId) {
  var m = bknMeta;
  var otCount = m.objectTypes.length;
  var rtCount = m.relationTypes.length;
  var knName = m.bkn.name || knId;

  $el.innerHTML =
    '<div class="breadcrumb"><a href="#/bkn">BKN</a> / ' + esc(knName) + '</div>' +
    '<h1 class="page-title">' + esc(knName) + '</h1>' +
    '<p class="page-subtitle">Knowledge Network Explorer</p>' +

    '<div class="stats-row">' +
      '<div class="stat-card"><div class="number">' + otCount + '</div><div class="label">Object Types</div></div>' +
      '<div class="stat-card"><div class="number">' + (m.statistics.object_count || "\u2014") + '</div><div class="label">Instances</div></div>' +
      '<div class="stat-card"><div class="number">' + rtCount + '</div><div class="label">Relation Types</div></div>' +
      '<div class="stat-card"><div class="number">' + (m.statistics.relation_count || "\u2014") + '</div><div class="label">Relations</div></div>' +
    '</div>' +

    '<div class="search-bar" style="margin-bottom:24px;">' +
      '<input type="text" id="bkn-search-input" placeholder="Semantic search..." />' +
      '<button id="bkn-search-btn">Search</button>' +
    '</div>' +

    '<h2 style="font-size:18px; margin-bottom:16px;">Object Types</h2>' +
    '<div class="ot-grid">' +
      m.objectTypes.map(function(ot) {
        return '<a href="#/bkn/' + enc(knId) + '/ot/' + enc(ot.id) + '" class="ot-card" style="text-decoration:none;color:inherit;">' +
          '<h3>' + esc(ot.name) + '</h3>' +
          '<div class="meta">' + ot.propertyCount + ' properties</div>' +
        '</a>';
      }).join("") +
    '</div>' +

    (rtCount > 0 ? (
      '<h2 style="font-size:18px; margin:24px 0 16px;">Relation Types</h2>' +
      '<div class="ot-grid">' +
        m.relationTypes.map(function(rt) {
          return '<a href="#/bkn/' + enc(knId) + '/rt/' + enc(rt.id) + '" class="ot-card" style="text-decoration:none;color:inherit;">' +
            '<h3>' + esc(rt.name) + '</h3>' +
            '<div class="meta">' + esc(rt.sourceOtName || rt.sourceOtId) + ' \u2192 ' + esc(rt.targetOtName || rt.targetOtId) + '</div>' +
          '</a>';
        }).join("") +
      '</div>'
    ) : '');

  // Bind search
  var searchInput = document.getElementById("bkn-search-input");
  var searchBtn = document.getElementById("bkn-search-btn");
  if (searchInput && searchBtn) {
    function doSearch() {
      var q = searchInput.value.trim();
      if (q) location.hash = "/bkn/" + enc(knId) + "/search?q=" + encodeURIComponent(q);
    }
    searchBtn.addEventListener("click", doSearch);
    searchInput.addEventListener("keydown", function(e) { if (e.key === "Enter") doSearch(); });
  }
}

// ── Object type instance list ───────────────────────────────────────────────

async function renderBknOtList($el, knId, otId, gen) {
  var ot = bknMeta.objectTypes.find(function(o) { return o.id === otId; });
  if (!ot) { $el.innerHTML = "<p>Object type not found</p>"; return; }
  var knName = bknMeta.bkn.name || knId;

  $el.innerHTML =
    '<div class="breadcrumb"><a href="#/bkn">BKN</a> / <a href="#/bkn/' + enc(knId) + '">' + esc(knName) + '</a> / ' + esc(ot.name) + '</div>' +
    '<h1 class="page-title">' + esc(ot.name) + '</h1>' +
    '<p class="page-subtitle">Display key: ' + esc(ot.displayKey) + ' \u00B7 ' + ot.propertyCount + ' properties</p>' +
    '<div id="field-picker"></div>' +
    '<div id="instance-container"><div class="loading">Loading instances...</div></div>' +
    '<div id="pagination-container"></div>';

  await bknLoadInstances(knId, otId, ot.displayKey, gen);
}

async function bknLoadInstances(knId, otId, displayKey, gen, searchAfter) {
  var data = await bknQueryInstancesCached(otId, { searchAfter: searchAfter });
  if (navGeneration !== gen) return;

  var container = document.getElementById("instance-container");
  if (!container) return;
  var items = data.datas ?? data.entries ?? [];

  if (items.length === 0) {
    container.innerHTML = '<p style="padding:20px;color:#666;">No instances</p>';
    return;
  }

  currentPageState = { knId: knId, otId: otId, displayKey: displayKey, items: items, searchAfter: data.search_after };

  // All available fields (non-internal, non-displayKey, with at least one non-empty value)
  var allFields = bknGetAllFields(items, displayKey);
  var autoFields = bknPickSubtitleFields(items, displayKey);
  var activeFields = userSubtitleFields[otId] ?? autoFields;

  bknRenderFieldPicker(knId, otId, allFields, activeFields, autoFields);
  bknRenderInstanceList(items, displayKey, activeFields, knId, otId);

  var pag = document.getElementById("pagination-container");
  if (items.length >= PAGE_SIZE && data.search_after) {
    pag.innerHTML = '<div class="pagination"><button id="next-page">Next page</button></div>';
    document.getElementById("next-page").onclick = function() {
      bknLoadInstances(knId, otId, displayKey, gen, data.search_after);
    };
  } else {
    pag.innerHTML = "";
  }
}

function bknRenderInstanceList(items, displayKey, subtitleFields, knId, otId) {
  var container = document.getElementById("instance-container");
  container.innerHTML = '<div class="instance-list">' +
    items.map(function(item) {
      var identity = item._instance_identity ?? {};
      var pk = Object.entries(identity).map(function(e) { return e[0] + "=" + e[1]; }).join("&");
      var name = item[displayKey] ?? Object.values(identity)[0] ?? "\u2014";
      var subtitle = bknBuildSubtitle(item, subtitleFields);
      return '<a href="#/bkn/' + enc(knId) + '/instance/' + enc(otId) + '/' + enc(pk) + '" class="instance-item" style="display:block;text-decoration:none;color:inherit;">' +
        '<div class="name">' + esc(String(name)) + '</div>' +
        (subtitle ? '<div class="instance-subtitle">' + esc(subtitle) + '</div>' : '') +
      '</a>';
    }).join("") +
  '</div>';
}

// ── Field picker ────────────────────────────────────────────────────────────

function bknGetAllFields(items, displayKey) {
  var skip = new Set(["_instance_identity", "_object_type_id", "_score", "_instance_id", "_display", "id", displayKey]);
  var fields = new Set();
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    for (var _i = 0, _a = Object.entries(item); _i < _a.length; _i++) {
      var k = _a[_i][0], v = _a[_i][1];
      if (k.startsWith("_") || skip.has(k) || v == null || v === "") continue;
      fields.add(k);
    }
  }
  return [...fields];
}

function bknRenderFieldPicker(knId, otId, allFields, activeFields, autoFields) {
  var picker = document.getElementById("field-picker");
  if (allFields.length === 0) { picker.innerHTML = ""; return; }

  var activeSet = new Set(activeFields);
  picker.innerHTML =
    '<div class="field-picker">' +
      '<span class="field-picker-label">Subtitle fields:</span>' +
      allFields.map(function(f) {
        return '<button class="field-chip ' + (activeSet.has(f) ? "active" : "") + '" data-field="' + esc(f) + '">' + esc(f) + '</button>';
      }).join("") +
      '<button class="field-chip field-chip-auto" title="Reset to auto-detected">Auto</button>' +
    '</div>';

  picker.querySelectorAll(".field-chip[data-field]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var field = btn.dataset.field;
      var selected = userSubtitleFields[otId] ? [...userSubtitleFields[otId]] : [...activeFields];
      if (selected.includes(field)) {
        selected = selected.filter(function(f) { return f !== field; });
      } else {
        selected.push(field);
      }
      userSubtitleFields[otId] = selected;
      bknRenderFieldPicker(knId, otId, allFields, selected, autoFields);
      bknRenderInstanceList(currentPageState.items, currentPageState.displayKey, selected, knId, otId);
    });
  });

  picker.querySelector(".field-chip-auto").addEventListener("click", function() {
    delete userSubtitleFields[otId];
    bknRenderFieldPicker(knId, otId, allFields, autoFields, autoFields);
    bknRenderInstanceList(currentPageState.items, currentPageState.displayKey, autoFields, knId, otId);
  });
}

// ── Instance detail ─────────────────────────────────────────────────────────

async function renderBknInstance($el, knId, otId, instanceId, gen) {
  var ot = bknMeta.objectTypes.find(function(o) { return o.id === otId; });
  if (!ot) { $el.innerHTML = "<p>Object type not found</p>"; return; }
  var knName = bknMeta.bkn.name || knId;

  var identity = {};
  instanceId.split("&").forEach(function(pair) {
    var parts = pair.split("=");
    var k = parts[0];
    var raw = decodeURIComponent(parts.slice(1).join("="));
    // Preserve numeric types for identity values
    var num = Number(raw);
    identity[decodeURIComponent(k)] = (raw !== "" && !isNaN(num)) ? num : raw;
  });

  // Try cache first (populated from list view)
  var pk = instanceId;
  var detailKey = bknCacheKey(otId, pk);
  var instance = null;
  if (bknIsFresh(instanceDetailCache[detailKey])) {
    instance = instanceDetailCache[detailKey].instance;
  } else {
    var data = await bknQueryInstances(otId, { _instance_identities: [identity], limit: 1 });
    if (navGeneration !== gen) return;
    var items = data.datas ?? data.entries ?? [];
    instance = items[0];
    if (instance) {
      instanceDetailCache[detailKey] = { instance: instance, timestamp: Date.now() };
    }
  }

  if (!instance) {
    $el.innerHTML =
      '<div class="breadcrumb"><a href="#/bkn">BKN</a> / <a href="#/bkn/' + enc(knId) + '">' + esc(knName) + '</a> / <a href="#/bkn/' + enc(knId) + '/ot/' + enc(otId) + '">' + esc(ot.name) + '</a></div>' +
      '<p>Instance not found</p>';
    return;
  }

  var displayName = instance[ot.displayKey] ?? Object.values(identity)[0] ?? "\u2014";
  var props = Object.entries(instance).filter(function(e) { return !e[0].startsWith("_"); });
  var propsHtml = props.map(function(e) {
    return '<tr><td>' + esc(e[0]) + '</td><td>' + formatValue(e[1]) + '</td></tr>';
  }).join("");

  $el.innerHTML =
    '<div class="breadcrumb"><a href="#/bkn">BKN</a> / <a href="#/bkn/' + enc(knId) + '">' + esc(knName) + '</a> / <a href="#/bkn/' + enc(knId) + '/ot/' + enc(otId) + '">' + esc(ot.name) + '</a> / ' + esc(String(displayName)) + '</div>' +
    '<h1 class="page-title">' + esc(String(displayName)) + '</h1>' +
    '<p class="page-subtitle">' + esc(ot.name) + '</p>' +

    '<div class="detail-section">' +
      '<h2>Properties</h2>' +
      '<table class="props-table">' + propsHtml + '</table>' +
    '</div>' +

    '<div class="detail-section" id="relations-section">' +
      '<h2>Relations</h2>' +
      '<div id="relations-loading">Loading relations...</div>' +
    '</div>';

  bknLoadRelations(knId, otId, instance, gen);
}

async function bknLoadRelations(knId, otId, instance, gen) {
  var container = document.getElementById("relations-loading");
  if (!container) return;
  var relatedRts = bknMeta.relationTypes.filter(function(rt) {
    return rt.sourceOtId === otId || rt.targetOtId === otId;
  });

  if (relatedRts.length === 0) {
    container.innerHTML = '<p style="color:#666;">No relations</p>';
    return;
  }

  var html = "";
  for (var i = 0; i < relatedRts.length; i++) {
    var rt = relatedRts[i];
    var isSource = rt.sourceOtId === otId;
    var targetOtId = isSource ? rt.targetOtId : rt.sourceOtId;
    var targetOt = bknMeta.objectTypes.find(function(o) { return o.id === targetOtId; });
    if (!targetOt) continue;

    try {
      var body = {
        relation_type_paths: [{
          object_types: [
            { id: otId, condition: bknBuildInstanceCondition(instance), limit: 1 },
            { id: targetOtId, limit: 10 },
          ],
          relation_types: [{
            relation_type_id: rt.id,
            source_object_type_id: rt.sourceOtId,
            target_object_type_id: rt.targetOtId,
          }],
        }],
      };

      var result = await bknQuerySubgraphCached(body);
      if (navGeneration !== gen) return;
      var entries = result.entries ?? result.datas ?? [];

      if (entries.length === 0) continue;

      var links = bknExtractLinkedInstances(entries, targetOtId, targetOt.displayKey);
      if (links.length === 0) continue;

      html += '<div class="relation-group">' +
        '<h4>' + esc(rt.name) + ' \u2192 ' + esc(targetOt.name) + '</h4>' +
        '<div class="link-list">' +
          links.map(function(link) {
            return '<a href="#/bkn/' + enc(knId) + '/instance/' + enc(targetOtId) + '/' + enc(link.pk) + '" class="link-tag">' + esc(link.name) + '</a>';
          }).join("") +
        '</div>' +
      '</div>';
    } catch (e) {
      // Skip failed relation queries
    }
  }

  if (navGeneration !== gen) return;
  container.innerHTML = html || '<p style="color:#666;">No related instances</p>';
}

// ── Search ──────────────────────────────────────────────────────────────────

async function renderBknSearchView($el, knId, query, gen) {
  var knName = bknMeta.bkn.name || knId;

  $el.innerHTML =
    '<div class="breadcrumb"><a href="#/bkn">BKN</a> / <a href="#/bkn/' + enc(knId) + '">' + esc(knName) + '</a> / Search</div>' +
    '<h1 class="page-title">Search: ' + esc(query) + '</h1>' +
    '<div id="search-results"><div class="loading">Searching...</div></div>';

  if (!query) {
    document.getElementById("search-results").innerHTML = '<p style="color:#666;">Enter a search query.</p>';
    return;
  }

  try {
    var data = await bknSearchCached(query);
    if (navGeneration !== gen) return;
    var concepts = data.concepts ?? [];
    var container = document.getElementById("search-results");

    if (concepts.length === 0) {
      container.innerHTML = '<p style="color:#666;">No results found</p>';
      return;
    }

    container.innerHTML = concepts.map(function(c) {
      var ot = bknMeta.objectTypes.find(function(o) { return o.id === c.concept_type || o.name === c.concept_type; });
      var otId = ot ? ot.id : c.concept_type;
      var otName = ot ? ot.name : c.concept_type;
      var pk = c.concept_id ? "id=" + c.concept_id : "";
      var href = pk
        ? "#/bkn/" + enc(knId) + "/instance/" + enc(otId) + "/" + enc(pk)
        : "#/bkn/" + enc(knId) + "/ot/" + enc(otId);
      var score = (c.rerank_score ?? c.match_score ?? 0).toFixed(3);

      return '<a href="' + href + '" class="search-result" style="display:block;text-decoration:none;color:inherit;">' +
        '<span class="score">' + score + '</span>' +
        '<span class="type-badge">' + esc(otName) + '</span>' +
        '<strong>' + esc(c.concept_name) + '</strong>' +
      '</a>';
    }).join("");
  } catch (err) {
    if (navGeneration !== gen) return;
    document.getElementById("search-results").innerHTML = '<p>Search error: ' + esc(err.message) + '</p>';
  }
}

// ── Relation type detail ────────────────────────────────────────────────────

async function renderBknRtDetail($el, knId, rtId, gen) {
  var rt = bknMeta.relationTypes.find(function(r) { return r.id === rtId; });
  if (!rt) { $el.innerHTML = "<p>Relation type not found</p>"; return; }
  var knName = bknMeta.bkn.name || knId;

  var sourceOt = bknMeta.objectTypes.find(function(o) { return o.id === rt.sourceOtId; });
  var targetOt = bknMeta.objectTypes.find(function(o) { return o.id === rt.targetOtId; });
  var srcName = sourceOt ? sourceOt.name : rt.sourceOtId;
  var tgtName = targetOt ? targetOt.name : rt.targetOtId;
  var displayKey = sourceOt ? sourceOt.displayKey : undefined;

  $el.innerHTML =
    '<div class="breadcrumb"><a href="#/bkn">BKN</a> / <a href="#/bkn/' + enc(knId) + '">' + esc(knName) + '</a> / ' + esc(rt.name) + '</div>' +
    '<h1 class="page-title">' + esc(rt.name) + '</h1>' +
    '<p class="page-subtitle">' +
      '<a href="#/bkn/' + enc(knId) + '/ot/' + enc(rt.sourceOtId) + '" style="color:var(--accent);text-decoration:none;">' + esc(srcName) + '</a>' +
      ' \u2192 <a href="#/bkn/' + enc(knId) + '/ot/' + enc(rt.targetOtId) + '" style="color:var(--accent);text-decoration:none;">' + esc(tgtName) + '</a>' +
    '</p>' +
    '<div id="rt-instances"><div class="loading">Loading relations...</div></div>';

  // Use cached RT results if available
  var results;
  if (bknIsFresh(rtDetailCache[rtId])) {
    results = rtDetailCache[rtId].results;
  } else {
    // Load source OT instances
    var data = await bknQueryInstancesCached(rt.sourceOtId, {});
    if (navGeneration !== gen) return;
    var items = data.datas ?? data.entries ?? [];

    if (items.length === 0) {
      var c = document.getElementById("rt-instances");
      if (c) c.innerHTML = '<p style="padding:20px;color:#666;">No instances</p>';
      return;
    }

    // Batch-query relations (3 concurrent, with cancellation)
    results = [];
    var BATCH = 3;
    for (var i = 0; i < items.length; i += BATCH) {
      if (navGeneration !== gen) return; // user navigated away, stop querying
      var batch = items.slice(i, i + BATCH);
      var promises = batch.map(function(item) {
        var body = {
          relation_type_paths: [{
            object_types: [
              { id: rt.sourceOtId, condition: bknBuildInstanceCondition(item), limit: 1 },
              { id: rt.targetOtId, limit: 20 },
            ],
            relation_types: [{
              relation_type_id: rt.id,
              source_object_type_id: rt.sourceOtId,
              target_object_type_id: rt.targetOtId,
            }],
          }],
        };
        return bknQuerySubgraphCached(body).then(function(result) {
          var entries = result.entries ?? result.datas ?? [];
          var links = bknExtractLinkedInstances(entries, rt.targetOtId, targetOt ? targetOt.displayKey : undefined);
          return { sourceItem: item, links: links };
        }).catch(function() {
          return { sourceItem: item, links: [] };
        });
      });
      var batchResults = await Promise.all(promises);
      results.push.apply(results, batchResults);
    }

    if (navGeneration !== gen) return;
    rtDetailCache[rtId] = { results: results, timestamp: Date.now() };
  }

  // Render
  var container = document.getElementById("rt-instances");
  if (!container) return;

  var withLinks = results.filter(function(r) { return r.links.length > 0; });
  var withoutLinks = results.filter(function(r) { return r.links.length === 0; });

  var html = "";

  if (withLinks.length > 0) {
    html += '<div class="instance-list">' +
      withLinks.map(function(r) {
        var identity = r.sourceItem._instance_identity ?? {};
        var pk = Object.entries(identity).map(function(e) { return e[0] + "=" + e[1]; }).join("&");
        var name = (displayKey && r.sourceItem[displayKey]) ?? Object.values(identity)[0] ?? "\u2014";
        return '<div class="rt-source-item">' +
          '<div class="rt-source-header">' +
            '<a href="#/bkn/' + enc(knId) + '/instance/' + enc(rt.sourceOtId) + '/' + enc(pk) + '" class="name">' + esc(String(name)) + '</a>' +
            '<span class="rt-link-count">' + r.links.length + ' relation(s)</span>' +
          '</div>' +
          '<div class="rt-targets" style="display:block;">' +
            '<div class="link-list">' +
              r.links.map(function(link) {
                return '<a href="#/bkn/' + enc(knId) + '/instance/' + enc(rt.targetOtId) + '/' + enc(link.pk) + '" class="link-tag">' + esc(link.name) + '</a>';
              }).join("") +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>';
  } else {
    html += '<p style="padding:20px;color:#666;">No relation instances found</p>';
  }

  if (withoutLinks.length > 0) {
    html += '<details class="rt-no-links-section">' +
      '<summary>' + withoutLinks.length + ' ' + esc(srcName) + ' instance(s) with no relations</summary>' +
      '<div class="rt-no-links-list">' +
        withoutLinks.map(function(r) {
          var identity = r.sourceItem._instance_identity ?? {};
          var pk = Object.entries(identity).map(function(e) { return e[0] + "=" + e[1]; }).join("&");
          var name = (displayKey && r.sourceItem[displayKey]) ?? Object.values(identity)[0] ?? "\u2014";
          return '<a href="#/bkn/' + enc(knId) + '/instance/' + enc(rt.sourceOtId) + '/' + enc(pk) + '" class="rt-no-link-item">' + esc(String(name)) + '</a>';
        }).join("") +
      '</div>' +
    '</details>';
  }

  container.innerHTML = html;
}

// ── Condition builder for subgraph queries ──────────────────────────────────

function bknBuildInstanceCondition(instance) {
  var identity = instance._instance_identity ?? {};
  return {
    operation: "and",
    sub_conditions: Object.entries(identity).map(function(e) {
      return { field: e[0], operation: "==", value: e[1] };
    }),
  };
}

// ── Extract linked instances from subgraph results ──────────────────────────

function bknExtractLinkedInstances(entries, targetOtId, displayKey) {
  var results = [];
  var seen = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }

    if (obj._instance_identity) {
      var identity = obj._instance_identity;
      var pk = Object.entries(identity).map(function(e) { return e[0] + "=" + e[1]; }).join("&");
      if (!seen.has(pk)) {
        seen.add(pk);
        var name = (displayKey && obj[displayKey]) ?? Object.values(identity)[0] ?? "\u2014";
        results.push({ pk: pk, name: String(name) });
      }
    }

    var values = Object.values(obj);
    for (var i = 0; i < values.length; i++) {
      walk(values[i]);
    }
  }

  walk(entries);
  return results;
}

// ── Subtitle helpers ────────────────────────────────────────────────────────

function bknPickSubtitleFields(items, displayKey, topN) {
  if (!topN) topN = 3;
  var skip = new Set(["_instance_identity", "_object_type_id", "_score", "_instance_id", "_display", "id", displayKey]);
  // Collect unique values per field across all items
  var fieldValues = {}; // field -> Set of values
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    for (var _i = 0, _a = Object.entries(item); _i < _a.length; _i++) {
      var k = _a[_i][0], v = _a[_i][1];
      if (k.startsWith("_") || skip.has(k) || v == null || v === "") continue;
      var str = formatValue(v);
      if (str.length > 50) continue;
      if (!fieldValues[k]) fieldValues[k] = new Set();
      fieldValues[k].add(str);
    }
  }
  // Sort by number of unique values (descending) — more unique = more distinguishing
  return Object.entries(fieldValues)
    .sort(function(a, b) { return b[1].size - a[1].size; })
    .slice(0, topN)
    .map(function(e) { return e[0]; });
}

function bknBuildSubtitle(item, subtitleFields) {
  return subtitleFields
    .filter(function(k) { return item[k] != null && item[k] !== ""; })
    .map(function(k) { return k + ": " + formatValue(item[k]); })
    .join(" \u00B7 ");
}
