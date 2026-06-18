# NOBARA KDESYNC · 3D Filesystem Navigator

Your Linux filesystem rendered as a spiral galaxy — top-level directories are
**stars**, subdirectories **planets**, files **asteroids**, mount points
**wormholes**, virtual filesystems **nebulae**, and boot-critical paths glow
red. It is a self-contained local web app: a tiny Python standard-library
backend that introspects *your* machine, and a Three.js/WebGL front end that
draws the HUD from the screenshot.

Built to run on **Nobara KDE + NVIDIA**, but it works on any Linux box with
Python 3 and a modern browser.

---

## What you get

A live recreation of the mockup, driven by real data from your system:

- **Galactic view** — procedural spiral disk + bloom, every top-level directory
  placed as a glowing star sized by how much it contains, with orbiting planets.
- **System Overview** — distro, kernel, uptime, user, hostname, boot mode, GPU,
  RAM, disk + filesystem — all auto-detected.
- **Object Information** — click any body: purpose, criticality, size/file count,
  owner, dependencies, mount info, *safe-to-delete* verdict, and copy-ready
  inspect commands.
- **Dependency Graph** — a radial map of what the selected node depends on and
  what depends on it. Selecting `/boot` reproduces the boot-chain graph in the
  image.
- **Boot Sequence Chain** — UEFI → EFI → GRUB2 → Kernel → Initramfs → systemd → KDE.
- **Storage Map** — block devices and btrfs subvolumes from `lsblk`.
- **System Health** — live CPU / memory / load (with temperature if available).
- **View modes** (Galactic / System Map / Orbit / List) and **overlays**
  (Dependencies / Ownership / Size / Activity), plus glow, rotation, zoom, and
  filesystem search.

> The galaxy art is procedural, not a bitmap — so it animates and reacts to
> selection, hover, and overlays instead of being a static backdrop.

---

## Requirements

- **Python 3.8+** (Nobara ships with it)
- A modern browser with WebGL2 — Firefox, Chromium/Chrome, or Brave
- *Optional:* `psutil` for nicer health stats (the backend falls back to `/proc`
  and stdlib without it)

No Node, no build step, no system packages required.

> **Internet on first run:** the front end pulls Three.js and the fonts from a
> CDN the first time you open it. See *Running fully offline* below to vendor
> them locally.

---

## Quick start

```bash
cd unix-3d-galaxy-nav
python3 backend/server.py
```

Then open <http://127.0.0.1:8000/>.

Or use the launcher script (starts the server **and** opens your browser):

```bash
./run.sh
```

### Guided install (optional)

```bash
./install.sh
```

This offers to create a local `.venv` with `psutil` and to install a KDE
application-menu entry (search **"KDESYNC"** afterwards). Nothing needs root.

---

## Server options

```bash
python3 backend/server.py --host 127.0.0.1 --port 8000 --root / --depth 2
```

| Flag       | Default     | Meaning                                            |
|------------|-------------|----------------------------------------------------|
| `--host`   | `127.0.0.1` | Bind address (keep on loopback unless you mean it). |
| `--port`   | `8000`      | HTTP port.                                          |
| `--root`   | `/`         | Where the galaxy core sits — try `/home/user`.      |
| `--depth`  | `2`         | How deep the initial scan walks.                    |

`run.sh` honors `HOST`, `PORT`, and `DEPTH` env vars, e.g. `PORT=8200 ./run.sh`.

---

## Using the HUD

- **Click** a star/planet to inspect it — fills Object Information + Dependency
  Graph, and the action buttons target that path.
- **Hover** to highlight; the cursor changes over selectable bodies.
- **Drag** to orbit, **scroll** to zoom, or use the **ZOOM** slider.
- **VIEW MODE** — Galactic (default), System Map (top-down), Orbit (focus),
  List (a scrollable DOM tree).
- **OVERLAY** — Dependencies (arcs between related stars), Ownership (red = root,
  green = user), Size (scale by content), Activity (gentle pulse).
- **CRITICALITY** legend entries are clickable filters.
- **Search** jumps to any path.
- **ACTIONS** copy ready-to-run commands (open in file manager/terminal,
  `rpm -qf`, `du -sh`, unmount, …) to your clipboard — the app never executes
  anything on your behalf.

---

## Customization

Everything that classifies the filesystem lives in **data tables** at the top of
`backend/fs_scanner.py` — edit these, no other code changes needed:

| Table               | Controls                                                        |
|---------------------|-----------------------------------------------------------------|
| `CRITICALITY`       | The six tiers and their colors.                                 |
| `TOPLEVEL_PROFILE`  | Each top-level dir's criticality + the "Purpose" blurb.         |
| `VIRTUAL_FS_ROOTS`  | Which roots are treated as virtual/pseudo filesystems.          |
| `NEVER_DELETE`      | Paths that report **Safe to delete: NO**.                       |
| `DEPENDENCY_EDGES`  | The dependency arrows shown in the graph (`path → [(target, label)]`). |

Front-end tweaks:

- **Boot chain** steps live in `BOOT_CHAIN` in `frontend/js/ui.js`.
- **Reverse dependencies** ("Required by") in `REQUIRED_BY` there too.
- **Look & feel** — colors, fonts, glow — are CSS variables at the top of
  `frontend/css/style.css`.
- **Bloom / spiral density / star placement** are constants near the top of
  `frontend/js/galaxy.js`.

---

## Architecture

```
unix-3d-galaxy-nav/
├── backend/
│   ├── server.py        # stdlib ThreadingHTTPServer + JSON API + static files
│   ├── fs_scanner.py    # walks the FS, classifies kind + criticality, builds the galaxy
│   └── sysinfo.py       # distro / kernel / GPU / health / storage detection
├── frontend/
│   ├── index.html       # the HUD layout
│   ├── css/style.css    # the galactic theme
│   └── js/
│       ├── main.js      # bootstrap: load data, wire selection + polling
│       ├── galaxy.js    # Three.js scene (spiral, stars, planets, bloom, picking)
│       ├── ui.js        # panel population + every control
│       └── api.js       # thin fetch client
├── packaging/
│   └── nobara-kdesync.desktop
├── run.sh
├── install.sh
└── README.md
```

**API** (all GET, all JSON):
`/api/system`, `/api/health`, `/api/storage`, `/api/config`,
`/api/tree?path=&depth=`, `/api/node?path=`, `/api/children?path=&depth=`.

The backend only ever **reads** your filesystem and binds to localhost by
default. It runs no shell commands from the browser.

---

## Running fully offline

The front end loads Three.js and Google Fonts from a CDN. To cut that
dependency, download `three.module.js` and the `examples/jsm/` addons into
`frontend/vendor/three/`, swap the `<script type="importmap">` block in
`index.html` to point at those local files, and replace the Google Fonts
`<link>` with locally hosted `@font-face` rules. After that the app needs no
network at all.

---

## Troubleshooting

- **Blank canvas / no galaxy** — your browser couldn't load Three.js from the
  CDN (offline or blocked). Check the dev-console, or vendor it locally (above).
- **"Could not reach the backend"** on the loading screen — the Python server
  isn't running; start `python3 backend/server.py` and reload.
- **Port already in use** — `python3 backend/server.py --port 8200`.
- **GPU shows "unknown"** — `nvidia-smi` wasn't found; it falls back to `lspci`.
  On the NVIDIA proprietary driver this populates correctly.
- **Wayland (KDE default on Nobara)** — WebGL runs fine in-browser on Wayland;
  no Xorg needed.
- **Health stats look flat** — install `psutil` (re-run `./install.sh`) for
  per-core CPU, memory, and temperature.

---

## A note on this build

This is a faithful **v1** of the screenshot, wired to live system data and
verified end-to-end against the backend API. The 3D scene is written carefully
against the Three.js r160 API but the visual layer hasn't yet been pixel-tuned
in a live browser, so expect to nudge a few constants (bloom strength, star
sizes, label spacing in `galaxy.js`; panel widths in `style.css`) to get it
exactly where you want. All the data plumbing, detection, classification, and
interactions are done and working.
