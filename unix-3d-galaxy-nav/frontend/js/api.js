const BASE = "";

async function getJSON(path, params = {}) {
  const url = new URL(BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  system: () => getJSON("/api/system"),
  health: () => getJSON("/api/health"),
  storage: () => getJSON("/api/storage"),
  processes: (limit) => getJSON("/api/processes", { limit }),
  config: () => getJSON("/api/config"),
  tree: (path, depth) => getJSON("/api/tree", { path, depth }),
  node: (path) => getJSON("/api/node", { path }),
  children: (path, depth) => getJSON("/api/children", { path, depth }),
};
