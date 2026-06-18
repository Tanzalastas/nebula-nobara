export const BOOT_CHAIN = [
  { label: "UEFI Firmware", sub: "1", path: "/sys/firmware/efi", icon: "▤" },
  { label: "EFI System\nPartition\n/boot/efi", sub: "2", path: "/boot/efi", icon: "💾" },
  { label: "GRUB2\n/boot/grub2", sub: "3", path: "/boot/grub2", icon: "⚙" },
  { label: "Kernel\nvmlinuz-*", sub: "4", path: "/boot", icon: "🐧" },
  { label: "Initramfs\ninitramfs-*.img", sub: "5", path: "/boot", icon: "📦" },
  { label: "systemd\n/sbin/init", sub: "6", path: "/etc/systemd", icon: "⚙" },
  { label: "KDE Plasma\ngraphical.target", sub: "7", path: "/usr/share/plasma", icon: "❄" }
];

export const REQUIRED_BY = {
  "/boot": ["Bootloader (GRUB2)", "Kernel", "Initramfs", "System Boot Process"],
  "/etc/systemd": ["systemd", "KDE session"],
  "/usr/lib/modules": ["Kernel"],
};

const CRITICALITY_ORDER = ["critical", "high", "important", "normal", "low", "virtual"];
const CRITICALITY_META = {
  critical: { label: "CRITICAL (Boot/Essen.)", color: "#ff3b3b", icon: "⯎" },
  high: { label: "HIGH (System)", color: "#ff9d3b", icon: "■" },
  important: { label: "MEDIUM (Important)", color: "#ffd83b", icon: "■" },
  normal: { label: "LOW (Optional)", color: "#7dff8a", icon: "■" },
  low: { label: "MINIMAL (Cache/Temp)", color: "#3bd6ff", icon: "■" },
  virtual: { label: "VIRTUAL (Runtime)", color: "#b66bff", icon: "■" },
};

function fmtBytes(n) {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function el(id) { return document.getElementById(id); }

const VIEW_SUBTITLES = {
  galactic: "GALACTIC ORBIT VIEW", systemmap: "SYSTEM MAP VIEW",
  orbit: "ORBIT VIEW", list: "LIST VIEW",
};

// Global reference for SVG clicks
let globalNavHandler = null;

export function initUI(handlers) {
  globalNavHandler = handlers.onSelectPath;
  const disabledCriticalities = new Set();

  document.querySelectorAll("#view-mode-buttons button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#view-mode-buttons button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      handlers.onViewMode?.(btn.dataset.mode);
    });
  });

  document.querySelectorAll("#overlay-buttons button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#overlay-buttons button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      handlers.onOverlay?.(btn.dataset.overlay);
    });
  });

  el("status-zoom").addEventListener("input", e => handlers.onZoom?.(parseFloat(e.target.value)));
  el("status-glow").addEventListener("change", e => {
    const v = e.target.checked ? 1 : 0;
    document.documentElement.style.setProperty("--glow", v);
    handlers.onGlow?.(v);
  });
  el("status-rotate").addEventListener("change", e => handlers.onRotation?.(e.target.checked ? 0.2 : 0));
  el("search-input").addEventListener("input", e => handlers.onSearch?.(e.target.value.trim()));

  // Delegate clicks for the dependency graph
  const depGraph = el("dependency-graph");
  depGraph.removeEventListener("click", handleDepGraphClick); // prevent duplicates
  depGraph.addEventListener("click", handleDepGraphClick);

  renderLegend(disabledCriticalities, (tier, enabled) => handlers.onCriticalityFilter?.(tier, enabled));
  renderBootChain(path => handlers.onSelectPath?.(path));
  wireActions(name => handlers.onAction?.(name));
}

function handleDepGraphClick(e) {
  const target = e.target.closest(".dep-navigable");
  if (target && target.dataset.path && globalNavHandler) {
    globalNavHandler(target.dataset.path);
  }
}

function renderLegend(disabledSet, onToggle) {
  const root = el("criticality-legend");
  root.innerHTML = "";
  for (const tier of CRITICALITY_ORDER) {
    const meta = CRITICALITY_META[tier];
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="color:${meta.color}">${meta.icon}</span>${meta.label}`;
    item.addEventListener("click", () => {
      if (disabledSet.has(tier)) { disabledSet.delete(tier); item.classList.remove("disabled"); } 
      else { disabledSet.add(tier); item.classList.add("disabled"); }
      onToggle(tier, !disabledSet.has(tier));
    });
    root.appendChild(item);
  }
}

function renderBootChain(onClick) {
  const root = el("boot-chain");
  root.innerHTML = "";
  BOOT_CHAIN.forEach((step, i) => {
    const chip = document.createElement("div");
    chip.className = "boot-step";
    chip.title = step.path;
    chip.innerHTML = `
      <div class="step-num">${step.sub}</div>
      <div class="step-icon-wrap">${step.icon}</div>
      <div class="step-label">${step.label.replace('\n', '<br>')}</div>
    `;
    chip.addEventListener("click", () => onClick(step.path));
    root.appendChild(chip);
    if (i < BOOT_CHAIN.length - 1) {
      const arrow = document.createElement("div");
      arrow.className = "boot-arrow"; arrow.innerHTML = "➔";
      root.appendChild(arrow);
    }
  });
}

function wireActions(onAction) {
  const root = el("actions-list");
  if (!root) return;
  root.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", () => onAction(btn.dataset.act));
  });
}

export function populateSystemOverview(system) {
  const root = el("overview-grid");
  const rows = [
    ["OS", system.distro || "Unknown Linux"],
    ["Kernel", system.kernel],
    ["Architecture", system.arch],
    ["Uptime", system.uptime],
    ["User", system.user],
    ["Hostname", system.hostname],
    ["Boot Mode", system.boot_mode],
    ["GPU", system.gpu?.name || "Unknown"],
    ["RAM", `${fmtBytes(system.ram?.used_bytes)} / ${fmtBytes(system.ram?.total_bytes)} (${system.ram?.percent}%)`],
    ["Disk (/)", `${fmtBytes(system.disk?.used_bytes)} / ${fmtBytes(system.disk?.total_bytes)} (${system.disk?.percent}%) - ${system.disk?.filesystem}`],
  ];
  root.innerHTML = rows.map(([k, v]) => `<div class="label">${k}:</div><div class="value">${v ?? "—"}</div>`).join("");
}

export function populateHealth(health) {
  const status = el("health-status");
  if (!status) return;
  const cpu = health.cpu_percent ?? 0;
  const mem = health.memory?.percent ?? 0;
  let word = "Excellent", cls = "excellent";
  if (cpu > 85 || mem > 90) { word = "Critical"; cls = "critical"; }
  else if (cpu > 60 || mem > 75) { word = "Fair"; cls = "fair"; }
  status.textContent = word;
  status.style.color = word === "Excellent" ? "var(--low)" : word === "Critical" ? "var(--critical)" : "var(--important)";
}

function renderDeviceLine(dev, prefix, isLast) {
  const branch = isLast ? "└─" : "├─";
  const name = dev.name || "?";
  const size = (dev.size || "").padEnd(7);
  const detail = dev.mountpoint ? `${dev.mountpoint}  (${dev.fstype || "?"})` : (dev.fstype || "");
  let out = `${prefix}${branch} ${name.padEnd(12)} ${size} ${detail}\n`;
  const children = dev.children || [];
  children.forEach((child, i) => {
    out += renderDeviceLine(child, prefix + (isLast ? "   " : "│  "), i === children.length - 1);
  });
  return out;
}

export function populateStorage(storage) {
  const devices = storage?.block_devices || [];
  let out = devices.map((dev, i) => renderDeviceLine(dev, "", i === devices.length - 1)).join("");
  if (storage?.btrfs_subvolumes?.length) {
    out += `\nBtrfs subvolumes (/):\n`;
    storage.btrfs_subvolumes.forEach((sv) => { out += `  • ${sv}\n`; });
  }
  el("storage-map").textContent = out.trim() || "No block devices detected.";
}

export function showObjectInfo(info) {
  el("object-info-empty").classList.add("hidden");
  el("object-info-content").classList.remove("hidden");

  el("oi-badge-icon").textContent = info.kind === "star" ? "★" : "●";
  el("oi-badge-icon").style.color = info.criticality_color;
  el("oi-path").textContent = info.path;
  el("oi-path").style.color = info.criticality_color;
  
  const typeMap = { "star": "Top Level Directory (Star)", "planet": "Subdirectory (Planet)" };
  el("oi-criticality").textContent = typeMap[info.kind] || info.kind;

  el("oi-purpose").textContent = info.purpose || "Contains system files.";
  
  const critRow = el("oi-crit-row");
  const critText = info.criticality === "critical" ? "CRITICAL (BOOT)" : info.criticality.toUpperCase();
  critRow.innerHTML = `Criticality: <span style="color:${info.criticality_color}; font-weight:600;">${critText}</span>`;
  
  el("oi-size").textContent = fmtBytes(info.size_bytes);
  el("oi-files").textContent = info.file_count || "—";
  el("oi-owner").textContent = info.owner === "root" ? "kernel-core, grub2-tools, dracut, systemd" : info.owner;
  
  const depList = el("oi-deps");
  depList.innerHTML = (info.dependencies || []).map(d => `<li>${d.target} ${d.label ? `(${d.label})` : ''}</li>`).join("");
  
  const reqList = el("oi-reqs");
  const reqs = REQUIRED_BY[info.path] || info.dependents || [];
  reqList.innerHTML = reqs.map(r => `<li>${r}</li>`).join("");

  el("oi-mount").textContent = info.is_mount ? info.path : "N/A";
  el("oi-device").textContent = info.mount_info?.device || "/dev/nvme0n1p2";
  el("oi-fstype").textContent = info.mount_info?.fstype || "ext4";

  const safeSpan = el("oi-safe");
  safeSpan.textContent = info.safe_to_delete ? "YES" : "NO";
  safeSpan.style.color = info.safe_to_delete ? "var(--low)" : "var(--critical)";

  const cmdRoot = el("oi-commands");
  cmdRoot.innerHTML = "";
  for (const cmd of info.inspect_commands.slice(0, 4)) {
    const code = document.createElement("code");
    code.textContent = cmd;
    code.addEventListener("click", () => navigator.clipboard?.writeText(cmd));
    cmdRoot.appendChild(code);
  }

  const dgSelected = el("dg-selected");
  if (dgSelected) dgSelected.textContent = info.path;
  renderDependencyGraph(info);
}

function pathName(p) {
  if (p === "/") return "/";
  return p.split("/").filter(Boolean).pop() || p;
}

export function renderDependencyGraph(info) {
  const svg = el("dependency-graph");
  const isCritical = info.criticality === "critical";
  const centerName = info.name || pathName(info.path) || "Node";

  const parentPath = info.path === "/" ? null : (info.path.replace(/\/[^/]+\/?$/, "") || "/");
  const parentNode = parentPath !== null
    ? { label: pathName(parentPath), sub: "(parent)", path: parentPath, cls: "parent", marker: "arrow-parent" }
    : null;

  const childNodes = (info.children || []).slice(0, 4).map((c) => ({
    label: c.name || pathName(c.path), sub: c.is_dir === false ? "(file)" : "(subfolder)",
    path: c.path, cls: "child", marker: "arrow-child",
  }));

  const depCls = isCritical ? "" : "normal";
  const depMarker = isCritical ? "arrow-critical" : "arrow-normal";
  const depNodes = (info.dependencies || []).map((d) => ({
    label: d.target, sub: d.label ? `(${d.label})` : "", path: d.target, cls: depCls, marker: depMarker,
  }));

  const placed = [];
  if (parentNode) placed.push({ ...parentNode, angle: -Math.PI / 2, radius: 88 });
  depNodes.forEach((n, i, arr) => {
    const span = Math.PI * 0.5;
    const a = arr.length === 1 ? 0 : -span / 2 + (i / (arr.length - 1)) * span;
    placed.push({ ...n, angle: a, radius: 108 });
  });
  childNodes.forEach((n, i, arr) => {
    // Radius kept smaller than the dependency fan so the angular spread
    // can stay wide (room for the boxes) without swinging close enough
    // to the top to collide with the parent node's box.
    const span = Math.PI * 0.39;
    const a = Math.PI + (arr.length === 1 ? 0 : -span / 2 + (i / (arr.length - 1)) * span);
    placed.push({ ...n, angle: a, radius: 85 });
  });
  placed.forEach((n) => {
    n.x = Math.cos(n.angle) * n.radius;
    n.y = Math.sin(n.angle) * n.radius;
  });

  let html = `<defs>
    <marker id="arrow-critical" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#ff3b3b"/></marker>
    <marker id="arrow-normal" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#3bd6ff"/></marker>
    <marker id="arrow-child" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#7dff8a"/></marker>
    <marker id="arrow-parent" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#ffd83b"/></marker>
  </defs>`;

  placed.forEach((n) => {
    html += `<line x1="0" y1="0" x2="${(n.x * 0.75).toFixed(1)}" y2="${(n.y * 0.75).toFixed(1)}" class="dep-line ${n.cls}" marker-end="url(#${n.marker})" />`;
  });

  html += `<circle cx="0" cy="0" r="24" class="dep-center${isCritical ? "" : " normal"}" />
           <text x="0" y="4" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle" style="pointer-events: none;">${centerName}</text>`;

  placed.forEach((n) => {
    html += `
      <g transform="translate(${n.x.toFixed(1)}, ${n.y.toFixed(1)})" class="dep-navigable" data-path="${n.path}" style="cursor: pointer;">
        <rect x="-65" y="-18" width="130" height="36" class="dep-box ${n.cls}" />
        <text x="0" y="-2" class="dep-text-title" style="pointer-events: none;">${n.label}</text>
        <text x="0" y="10" class="dep-text-sub" style="pointer-events: none;">${n.sub}</text>
      </g>`;
  });
  svg.innerHTML = html;
}

export function renderSearchResults(matches, onPick) {}
export function renderListView(flatNodes, onPick) {}
export function setViewVisibility(mode) {
  const sub = el("view-subtitle");
  if (sub) sub.textContent = VIEW_SUBTITLES[mode] || VIEW_SUBTITLES.galactic;
}

export function populateStats(stats) {
  const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
  set("stat-stars", stats?.stars ?? 16);
  set("stat-planets", stats?.planets ?? 142);
}

export function populateDependencyLines(n) {}

export function populateProcesses(data) {
  const root = el("process-list");
  if (!root) return;
  const procs = data?.processes || [];
  root.innerHTML = procs.map((p) => `
    <div class="process-row">
      <span class="proc-name" title="${p.name}">${p.name}</span>
      <span class="proc-pid">${p.pid}</span>
      <span class="proc-cpu${p.cpu_percent >= 50 ? " hot" : ""}">${p.cpu_percent.toFixed(1)}%</span>
    </div>`).join("") || `<div class="muted">No process data.</div>`;
}

const MAX_LOG_LINES = 40;
export function pushLog(message) {
  const root = el("system-log");
  if (!root) return;
  const time = new Date().toTimeString().slice(0, 8);
  const line = document.createElement("div");
  line.className = "log-line";
  const timeSpan = document.createElement("span");
  timeSpan.className = "log-time";
  timeSpan.textContent = time;
  const msgSpan = document.createElement("span");
  msgSpan.className = "log-msg";
  msgSpan.textContent = message;
  line.append(timeSpan, msgSpan);
  root.appendChild(line);
  while (root.children.length > MAX_LOG_LINES) root.removeChild(root.firstChild);
}

export function setGalacticCoordinates(x, y, z) {
  const set = (id, v) => { const n = el(id); if (n) n.textContent = v.toFixed(1); };
  set("coord-x", x);
  set("coord-y", y);
  set("coord-z", z);
}

export function populateClock() {
  const node = el("clock"), dateNode = el("clock-date");
  if (!node) return;
  const now = new Date();
  let h = now.getHours(), m = String(now.getMinutes()).padStart(2, "0"), s = String(now.getSeconds()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  node.textContent = `${h}:${m}:${s} ${ampm}`;
  if (dateNode) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    dateNode.textContent = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  }
}

export function setZoomSlider(v) {
  const s = el("status-zoom"); if (s) s.value = String(v);
  const pct = el("status-zoom-pct");
  if (pct) pct.textContent = `${Math.round(((v - 10) / 640) * 100)}%`;
}

export function hideLoadingScreen() {
  el("loading-screen").classList.add("hidden");
  el("app").classList.remove("hidden");
}

export function setLoadingStatus(text) { el("loading-status").textContent = text; }
// EOF