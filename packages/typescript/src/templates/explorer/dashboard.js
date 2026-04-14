const dashboardCache = {};

async function renderDashboard($el) {
  const gen = navGeneration;
  $el.innerHTML = '<div class="loading-skeleton"><div class="skeleton skeleton-title"></div><div class="loading-skeleton grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div></div>';

  let data;
  try {
    data = await cachedFetch(dashboardCache, "main", () => api("GET", "/api/dashboard"));
  } catch (err) {
    $el.innerHTML = '<div class="error-banner">Failed to load dashboard. <a href="#/" onclick="location.reload()">Retry</a></div>';
    return;
  }
  if (navGeneration !== gen) return;

  const knList = extractList(data.kn);
  const agentList = extractListFromAgentApiResponse(data.agents);
  const catalogList = extractList(data.catalogs);

  $el.innerHTML = `
    <div class="dashboard">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2>Overview</h2>
        <input type="text" id="dashboard-search" class="dashboard-search" placeholder="Search resources..." autocomplete="off"/>
      </div>
      <div class="summary-cards">
        ${summaryCard("Knowledge Networks", knList, "#/bkn")}
        ${summaryCard("Decision Agents", agentList, "#/chat")}
        ${summaryCard("Vega Catalogs", catalogList, "#/vega")}
      </div>
      <div class="resource-sections">
        ${knList.length ? resourceSection("Knowledge Networks", knList, kn =>
          `<a class="resource-row" href="#/bkn/${enc(kn.id || kn.kg_id)}">
            <span class="resource-name">${esc(kn.name || kn.kg_name || kn.id)}</span>
            <span class="resource-meta">${esc(kn.description || "")}</span>
          </a>`) : ""}
        ${agentList.length ? resourceSection("Decision Agents", agentList, agent =>
          `<a class="resource-row" href="#/chat/${enc(agent.id || agent.agent_id)}">
            <span class="resource-name">${esc(agent.name || agent.agent_name || agent.id)}</span>
            <span class="resource-meta">${esc(agent.description || "")}</span>
          </a>`) : ""}
        ${catalogList.length ? resourceSection("Vega Catalogs", catalogList, cat =>
          `<a class="resource-row" href="#/vega/${enc(cat.id || cat.catalog_id)}">
            <span class="resource-name">${esc(cat.name || cat.catalog_name || cat.id)}</span>
            <span class="resource-meta">${esc(cat.type || "")}</span>
          </a>`) : ""}
      </div>
    </div>
  `;

  const $search = $el.querySelector("#dashboard-search");
  if ($search) {
    $search.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      const $rows = $el.querySelectorAll(".resource-row");
      $rows.forEach($row => {
        const text = $row.textContent.toLowerCase();
        $row.style.display = text.includes(q) ? "" : "none";
      });
      $el.querySelectorAll(".resource-section").forEach($sec => {
        const hasVisible = Array.from($sec.querySelectorAll(".resource-row")).some(r => r.style.display !== "none");
        $sec.style.display = hasVisible ? "" : "none";
      });
    });
  }
}

function summaryCard(title, list, href) {
  const count = list.length;
  const hasError = count === 0;
  return `<a class="summary-card${hasError ? " muted" : ""}" href="${href}">
    <div class="summary-card-label">${esc(title)}</div>
    <div class="summary-card-count">${count}</div>
  </a>`;
}

function resourceSection(title, list, renderItem) {
  return `<div class="resource-section">
    <h3>${esc(title)}</h3>
    <div class="resource-list">${list.map(renderItem).join("")}</div>
  </div>`;
}
