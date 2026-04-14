// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let navGeneration = 0;

// ---------------------------------------------------------------------------
// Inline SVG icons (Lucide-style, currentColor)
// ---------------------------------------------------------------------------
function exploreIcon(name, size) {
  const s = size == null ? 20 : size;
  const a = `class="icon-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    moon: `<svg ${a}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    sun: `<svg ${a}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
    user: `<svg ${a}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    bot: `<svg ${a}><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
    "message-circle": `<svg ${a}><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`,
    flask: `<svg ${a}><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 16H18l-5.069-5.577A2 2 0 0 1 12.78 10V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>`,
    "check-circle": `<svg ${a}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 12 2 2 4-4"/></svg>`,
    "x-circle": `<svg ${a}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
    wrench: `<svg ${a}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    lock: `<svg ${a}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    "alert-triangle": `<svg ${a}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    "bar-chart-2": `<svg ${a}><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>`,
  };
  return icons[name] || "";
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function enc(s) { return encodeURIComponent(s); }

function formatValue(v) {
  if (v == null) return '<span class="null">—</span>';
  if (typeof v === "object") return "<pre>" + esc(JSON.stringify(v, null, 2)) + "</pre>";
  return esc(String(v));
}

// ---------------------------------------------------------------------------
// Cache utility
// ---------------------------------------------------------------------------
const CACHE_TTL = 5 * 60 * 1000;

function cachedFetch(cache, key, fetcher) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return Promise.resolve(entry.data);
  return fetcher().then(data => { cache[key] = { data, ts: Date.now() }; return data; });
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const err = await res.json(); if (err.error) msg = err.error; } catch {}
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// List extraction helper (handles various API response shapes)
// ---------------------------------------------------------------------------
function extractList(obj) {
  if (obj == null || obj.error) return [];
  if (Array.isArray(obj)) return obj;
  // Align with CLI agent list parsing (agent-factory shapes vary by version).
  for (const k of ["entries", "items", "list", "records", "data", "agents", "knowledge_networks"]) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  if (typeof obj.data === "object" && obj.data !== null && !Array.isArray(obj.data)) {
    const nested = extractList(obj.data);
    if (nested.length) return nested;
  }
  return [];
}

/**
 * Agent-factory list responses sometimes include `res: {}` while the real array
 * lives at the top level (`entries`, `list`, etc.). Prefer `res` only when it yields rows.
 */
function extractListFromAgentApiResponse(raw) {
  if (raw == null || typeof raw !== "object") return [];
  if (raw.res != null) {
    const fromRes = extractList(raw.res);
    if (fromRes.length) return fromRes;
  }
  return extractList(raw);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function getRoute() {
  const hash = location.hash.slice(1) || "/";
  const [path, qs] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(qs || "");

  if (parts.length === 0) return { view: "dashboard" };

  const tab = parts[0];
  return { tab, parts: parts.slice(1), params };
}

function navigate() {
  navGeneration++;
  const route = getRoute();
  const $content = document.getElementById("content");

  // Update active tab (visual + accessibility)
  document.querySelectorAll("#tab-bar .tab").forEach(t => {
    const tabName = t.dataset.tab;
    const isActive = route.view === "dashboard"
      ? tabName === "dashboard"
      : tabName === route.tab;
    t.classList.toggle("active", isActive);
    if (isActive) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });

  // Dispatch to tab renderer
  if (route.view === "dashboard") {
    if (typeof renderDashboard === "function") renderDashboard($content);
    else $content.innerHTML = '<div class="loading">Dashboard loading...</div>';
  } else if (route.tab === "chat") {
    if (typeof renderChat === "function") renderChat($content, route.parts, route.params);
    else $content.innerHTML = '<div class="loading">Chat loading...</div>';
  } else if (route.tab === "bkn") {
    if (typeof renderBkn === "function") renderBkn($content, route.parts, route.params);
    else $content.innerHTML = '<div class="loading">BKN loading...</div>';
  } else if (route.tab === "vega") {
    if (typeof renderVega === "function") renderVega($content, route.parts, route.params);
    else $content.innerHTML = '<div class="loading">Vega loading...</div>';
  } else {
    $content.innerHTML = '<div class="error-banner">Unknown route</div>';
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.addEventListener("hashchange", navigate);
window.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    function syncThemeToggleUi() {
      const isDark = document.documentElement.getAttribute("data-theme") !== "light";
      themeToggle.textContent = isDark ? "☀️" : "🌙";
      themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
    }

    const savedTheme = localStorage.getItem("kweaver-theme");
    if (savedTheme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
      if (!savedTheme) localStorage.setItem("kweaver-theme", "dark");
    }
    syncThemeToggleUi();

    themeToggle.addEventListener("click", () => {
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      if (isLight) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("kweaver-theme", "dark");
      } else {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("kweaver-theme", "light");
      }
      syncThemeToggleUi();
    });
  }

  navigate();
});
