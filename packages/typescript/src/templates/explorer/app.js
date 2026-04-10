// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let navGeneration = 0;

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
  for (const k of ["entries", "data", "knowledge_networks", "items"]) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  return [];
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

  // Update active tab
  document.querySelectorAll("#tab-bar .tab").forEach(t => {
    const tabName = t.dataset.tab;
    const isActive = route.view === "dashboard"
      ? tabName === "dashboard"
      : tabName === route.tab;
    t.classList.toggle("active", isActive);
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
  } else if (route.tab === "composer") {
    if (typeof renderComposer === "function") renderComposer($content, route.parts, route.params);
    else $content.innerHTML = '<div class="loading">Composer loading...</div>';
  } else {
    $content.innerHTML = '<div class="error-banner">Unknown route</div>';
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.addEventListener("hashchange", navigate);
window.addEventListener("DOMContentLoaded", () => {
  // Theme Toggle
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    const savedTheme = localStorage.getItem("kweaver-theme");
    if (savedTheme) {
      document.documentElement.setAttribute("data-theme", savedTheme);
      themeToggle.textContent = savedTheme === "dark" ? "☀️" : "🌙";
    }
    themeToggle.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("kweaver-theme", newTheme);
      themeToggle.textContent = newTheme === "dark" ? "☀️" : "🌙";
    });
  }

  navigate();
});
