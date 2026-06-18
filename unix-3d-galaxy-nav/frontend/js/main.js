import { api } from "./api.js";
import { createGalaxy } from "./galaxy.js";
import {
  initUI,
  populateSystemOverview,
  populateHealth,
  populateStorage,
  populateProcesses,
  pushLog,
  setGalacticCoordinates,
  showObjectInfo,
  renderSearchResults,
  renderListView,
  setViewVisibility,
  hideLoadingScreen,
  setLoadingStatus,
} from "./ui.js";

const HEALTH_POLL_MS = 4000;
const PROCESS_POLL_MS = 5000;
const COORD_POLL_MS = 300;

let galaxy;
let allNodesFlat = [];

function flatten(node, depth = 0, out = []) {
  out.push({ path: node.path, criticality: node.criticality, depth });
  for (const child of node.children || []) flatten(child, depth + 1, out);
  return out;
}

async function selectPath(path, { jump = false } = {}) {
  try {
    const [info, childrenResult] = await Promise.all([
      api.node(path),
      api.children(path, 1).catch(() => null),
    ]);
    if (info.error) return;
    info.children = childrenResult?.children || [];
    showObjectInfo(info);
    pushLog(`Selected ${path} (${info.kind})`);
    if (jump) galaxy?.focus(path);
  } catch (err) {
    console.error("Failed to load node info for", path, err);
  }
}

function jumpToPath(path) {
  return selectPath(path, { jump: true });
}

async function boot() {
  const canvas = document.getElementById("galaxy-canvas");
  galaxy = createGalaxy(canvas);
  galaxy.onSelect((node) => selectPath(node.path));

  initUI({
    onViewMode: (mode) => {
      setViewVisibility(mode);
      galaxy.setViewMode(mode);
      if (mode === "list") renderListView(allNodesFlat, jumpToPath);
      pushLog(`View mode changed to ${mode.toUpperCase()}`);
    },
    onOverlay: (name) => {
      galaxy.setOverlay(name);
      pushLog(`Overlay set to ${name.toUpperCase()}`);
    },
    onGlow: (v) => galaxy.setGlow(v),
    onRotation: (v) => galaxy.setRotationSpeed(v),
    onZoom: (v) => galaxy.setZoom(v),
    onCriticalityFilter: (tier, enabled) => galaxy.setCriticalityFilter(tier, enabled),
    onSelectPath: (path) => jumpToPath(path),
    onSearch: (query) => {
      if (!query) return renderSearchResults([], jumpToPath);
      const matches = allNodesFlat.map((n) => n.path).filter((p) => p.toLowerCase().includes(query.toLowerCase()));
      renderSearchResults(matches, jumpToPath);
    },
    onAction: (action) => {
      const activePath = document.getElementById("oi-path").textContent;
      if (!activePath) return;

      switch(action) {
        case 'open-fm':
          alert(`In a native app, this would open your File Manager at: ${activePath}`);
          break;
        case 'open-term':
          alert(`In a native app, this would open your Terminal at: ${activePath}`);
          break;
        case 'analyze-deps':
          alert(`Analyzing dependencies for: ${activePath}\n(Check the Dependency Graph panel!)`);
          break;
        case 'show-owner':
          navigator.clipboard.writeText(`rpm -qf ${activePath}`);
          alert(`Copied "rpm -qf ${activePath}" to clipboard!`);
          break;
        case 'show-size':
          navigator.clipboard.writeText(`du -sh ${activePath}`);
          alert(`Copied "du -sh ${activePath}" to clipboard!`);
          break;
        case 'bookmark':
          alert(`Added ${activePath} to bookmarks!`);
          break;
        case 'unmount':
          navigator.clipboard.writeText(`umount ${activePath}`);
          alert(`Copied "umount ${activePath}" to clipboard!`);
          break;
      }
    }
  });

  try {
    setLoadingStatus("loading system info…");
    const system = await api.system();
    populateSystemOverview(system);

    setLoadingStatus("scanning filesystem…");
    const config = await api.config();
    const galaxyData = await api.tree(config.root, config.depth);
    
    // Pass the actual array of stars, not the top-level object
    galaxy.setData(galaxyData.stars || []);
    allNodesFlat = (galaxyData.stars || []).flatMap((s) => flatten(s));

    setLoadingStatus("loading storage map…");
    const storage = await api.storage();
    populateStorage(storage);

    setLoadingStatus("ready");
    hideLoadingScreen();
    pushLog(`Galaxy initialized: ${allNodesFlat.length} objects mapped from ${config.root}`);

    pollHealth();
    setInterval(pollHealth, HEALTH_POLL_MS);

    pollProcesses();
    setInterval(pollProcesses, PROCESS_POLL_MS);

    setInterval(pollCoordinates, COORD_POLL_MS);
  } catch (err) {
    console.error("Backend unreachable:", err);
    const detail = err && err.message ? err.message : String(err);
    setLoadingStatus(`Could not reach the backend at ${window.location.origin} — ${detail}. Is backend/server.py running on this port?`);
  }
}

async function pollHealth() {
  try {
    const health = await api.health();
    populateHealth(health);
  } catch (err) {
    console.error("health poll failed", err);
  }
}

async function pollProcesses() {
  try {
    const data = await api.processes(8);
    populateProcesses(data);
  } catch (err) {
    console.error("process poll failed", err);
  }
}

function pollCoordinates() {
  const pos = galaxy?.getCameraPosition();
  if (pos) setGalacticCoordinates(pos.x, pos.y, pos.z);
}

boot();
// EOF