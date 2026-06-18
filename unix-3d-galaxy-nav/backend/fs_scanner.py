"""Walks the filesystem, classifies paths, and builds the galaxy data the
front end renders. Everything that decides *what something is* and *how
critical it is* lives in the data tables below -- edit those, not the
functions, to retune classification.
"""

import os
import pwd
import stat
import subprocess

# ---------------------------------------------------------------------------
# Data tables -- edit these to retune classification. No other code changes
# needed.
# ---------------------------------------------------------------------------

CRITICALITY = {
    "critical":  {"label": "Critical",     "color": "#ff3b3b"},
    "high":      {"label": "High",         "color": "#ff9d3b"},
    "important": {"label": "Important",    "color": "#ffd83b"},
    "normal":    {"label": "Normal",       "color": "#3bd6ff"},
    "low":       {"label": "Low",          "color": "#7dff8a"},
    "virtual":   {"label": "Virtual / Pseudo", "color": "#b66bff"},
}

# Top-level directories: criticality tier + a human "purpose" blurb shown in
# the Object Information panel.
TOPLEVEL_PROFILE = {
    "/boot":  {"criticality": "critical",  "purpose": "Bootloader, kernel images, and initramfs needed to start the system."},
    "/efi":   {"criticality": "critical",  "purpose": "EFI System Partition mount holding UEFI boot files (on some layouts)."},
    "/etc":   {"criticality": "critical",  "purpose": "System-wide configuration for the OS, services, and installed software."},
    "/usr":   {"criticality": "critical",  "purpose": "Installed programs, libraries, and shared data -- the bulk of the OS."},
    "/bin":   {"criticality": "critical",  "purpose": "Essential user command binaries (often a symlink into /usr/bin)."},
    "/sbin":  {"criticality": "critical",  "purpose": "Essential system administration binaries (often a symlink into /usr/sbin)."},
    "/lib":   {"criticality": "critical",  "purpose": "Shared libraries needed by /bin and /sbin binaries (often a symlink into /usr/lib)."},
    "/lib64": {"criticality": "critical",  "purpose": "64-bit shared libraries needed at boot (often a symlink into /usr/lib64)."},
    "/var":   {"criticality": "high",      "purpose": "Variable runtime data: logs, caches, spool queues, and package databases."},
    "/root":  {"criticality": "high",      "purpose": "The superuser's home directory and personal configuration."},
    "/home":  {"criticality": "high",      "purpose": "Personal files, configuration, and data for regular user accounts."},
    "/opt":   {"criticality": "important", "purpose": "Optional third-party and self-contained application packages."},
    "/srv":   {"criticality": "important", "purpose": "Data served by this host, such as web or file-server content."},
    "/mnt":   {"criticality": "normal",     "purpose": "Conventional mount point for temporarily mounted filesystems."},
    "/media": {"criticality": "normal",     "purpose": "Auto-mount point for removable media like USB drives and discs."},
    "/tmp":   {"criticality": "low",        "purpose": "Temporary files; typically cleared on reboot. Safe to empty."},
    "/proc":  {"criticality": "virtual",    "purpose": "Kernel-provided virtual filesystem exposing process and system state."},
    "/sys":   {"criticality": "virtual",    "purpose": "Kernel-provided virtual filesystem exposing devices and kernel objects."},
    "/dev":   {"criticality": "virtual",    "purpose": "Device nodes for hardware and pseudo-devices, managed by the kernel/udev."},
    "/run":   {"criticality": "virtual",    "purpose": "tmpfs for runtime state: PIDs, sockets, and early-boot data."},
}

DEFAULT_PROFILE = {"criticality": "normal", "purpose": "A top-level directory on this system."}

# Roots treated as virtual/pseudo filesystems -- rendered as nebulae and
# never counted toward real disk usage.
VIRTUAL_FS_ROOTS = {"/proc", "/sys", "/dev", "/run"}

# Paths that always report "Safe to delete: NO" regardless of size/owner.
NEVER_DELETE = {
    "/", "/boot", "/efi", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64",
    "/var", "/root", "/home", "/proc", "/sys", "/dev", "/run",
}

# Dependency arrows shown in the Dependency Graph: path -> [(target, label)].
DEPENDENCY_EDGES = {
    "/boot": [("/etc/fstab", "mounted via"), ("/usr/lib/modules", "modules for")],
    "/etc/fstab": [("/", "describes"), ("/boot", "describes"), ("/home", "describes")],
    "/etc": [("/usr", "configures"), ("/var", "configures")],
    "/usr": [("/lib", "provides libs for"), ("/lib64", "provides libs for"), ("/bin", "provides bins for")],
    "/var/log": [("/etc/systemd", "written by")],
    "/home": [("/etc/passwd", "registered in")],
    "/": [("/boot", "mounts"), ("/etc", "mounts"), ("/usr", "mounts"), ("/var", "mounts"), ("/home", "mounts")],
}

# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------


def _read_mounts():
    mounts = {}
    try:
        with open("/proc/mounts") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 3:
                    mounts[parts[1]] = {"device": parts[0], "fstype": parts[2]}
    except OSError:
        pass
    return mounts


_MOUNTS = _read_mounts()


def is_mount_point(path):
    try:
        path = os.path.realpath(path)
    except OSError:
        return False
    return path in _MOUNTS or os.path.ismount(path)


def is_virtual_fs(path):
    norm = os.path.realpath(path) if os.path.exists(path) else path
    return any(norm == v or norm.startswith(v.rstrip("/") + "/") for v in VIRTUAL_FS_ROOTS)


def classify_kind(path, depth, is_dir, is_mount=None):
    """Returns one of: star, planet, asteroid, wormhole, nebula."""
    if is_virtual_fs(path):
        return "nebula"
    if is_mount is None:
        is_mount = is_dir and is_mount_point(path)
    if is_mount and path != "/":
        return "wormhole"
    if not is_dir:
        return "asteroid"
    if depth <= 1:
        return "star"
    return "planet"


def get_profile(path):
    if path in TOPLEVEL_PROFILE:
        return TOPLEVEL_PROFILE[path]
    return DEFAULT_PROFILE


def get_criticality(path):
    if path in NEVER_DELETE and path not in TOPLEVEL_PROFILE:
        return "critical"
    return get_profile(path)["criticality"]


def _owner(path):
    try:
        st = os.lstat(path)
        return pwd.getpwuid(st.st_uid).pw_name
    except (OSError, KeyError):
        return "unknown"


def _dir_stats(path, max_entries=20000):
    """Shallow-bounded recursive size/file count so huge trees (e.g. /) don't
    hang the request. Stops counting past max_entries but keeps walking size."""
    total_size = 0
    file_count = 0
    try:
        for entry_root, dirs, files in os.walk(path, onerror=lambda e: None):
            if is_virtual_fs(entry_root) and entry_root != path:
                dirs[:] = []
                continue
            for name in files:
                file_count += 1
                if file_count > max_entries:
                    return total_size, file_count, True
                try:
                    total_size += os.lstat(os.path.join(entry_root, name)).st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total_size, file_count, False


# ---------------------------------------------------------------------------
# Public API used by server.py
# ---------------------------------------------------------------------------


def list_children(path, depth=1):
    """Build a tree of nodes starting at `path`, descending `depth` levels."""
    return _build_node(path, remaining_depth=depth, top_level_root=path)


def _build_node(path, remaining_depth, top_level_root):
    try:
        st = os.lstat(path)
        is_dir = stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode)
    except OSError:
        is_dir = os.path.isdir(path)

    rel_depth = path.count("/") - top_level_root.rstrip("/").count("/") if path != top_level_root else (1 if path == "/" else 0)
    is_mount = is_dir and is_mount_point(path)
    kind = classify_kind(path, depth=1 if path == top_level_root else 2, is_dir=is_dir, is_mount=is_mount)

    node = {
        "path": path,
        "name": os.path.basename(path) or path,
        "kind": kind,
        "criticality": get_criticality(path) if path == top_level_root else (
            "virtual" if is_virtual_fs(path) else "normal"
        ),
        "is_dir": is_dir,
        "children": [],
    }

    try:
        node["size_bytes"] = os.lstat(path).st_size
    except OSError:
        node["size_bytes"] = 0

    if is_dir and remaining_depth > 0 and not is_virtual_fs(path):
        try:
            entries = sorted(os.listdir(path))
        except (OSError, PermissionError):
            entries = []
        child_count = 0
        for name in entries:
            if name.startswith(".") and path == "/":
                continue
            child_path = os.path.join(path, name)
            try:
                child = _build_node(child_path, remaining_depth - 1, top_level_root)
            except (OSError, PermissionError, RecursionError):
                continue
            node["children"].append(child)
            child_count += 1
        node["child_count"] = child_count
    else:
        try:
            node["child_count"] = len(os.listdir(path)) if is_dir else 0
        except OSError:
            node["child_count"] = 0

    return node


def build_galaxy(root="/", depth=2):
    """Top-level scan: every immediate child of `root` becomes a star."""
    try:
        names = sorted(os.listdir(root))
    except OSError:
        names = []

    stars = []
    for name in names:
        path = os.path.join(root, name) if root != "/" else "/" + name
        if not os.path.exists(path):
            continue
        try:
            node = list_children(path, depth=max(0, depth - 1))
        except (OSError, PermissionError):
            continue
        stars.append(node)

    return {"root": root, "stars": stars}


def get_node_info(path):
    """Detailed info for the Object Information panel."""
    if not os.path.exists(path):
        return {"error": "not found", "path": path}

    st = os.lstat(path)
    is_dir = stat.S_ISDIR(st.st_mode)
    is_link = stat.S_ISLNK(st.st_mode)
    is_mount = is_dir and is_mount_point(path)
    kind = classify_kind(path, depth=2, is_dir=is_dir, is_mount=is_mount)
    profile = get_profile(path)
    criticality = get_criticality(path)

    if is_dir and not is_virtual_fs(path):
        size_bytes, file_count, truncated = _dir_stats(path)
    else:
        size_bytes, file_count, truncated = st.st_size, (0 if is_dir else 1), False

    mount_info = None
    if is_mount:
        real = os.path.realpath(path)
        mount_info = _MOUNTS.get(real) or _MOUNTS.get(path)

    deps = DEPENDENCY_EDGES.get(path, [])
    dependents = [
        src for src, edges in DEPENDENCY_EDGES.items()
        for (target, _label) in edges
        if target == path
    ]

    safe_to_delete = path not in NEVER_DELETE and not is_virtual_fs(path) and path != "/"

    return {
        "path": path,
        "name": os.path.basename(path) or path,
        "kind": kind,
        "criticality": criticality,
        "criticality_label": CRITICALITY[criticality]["label"],
        "criticality_color": CRITICALITY[criticality]["color"],
        "purpose": profile["purpose"],
        "is_dir": is_dir,
        "is_link": is_link,
        "is_mount": is_mount,
        "is_virtual": is_virtual_fs(path),
        "size_bytes": size_bytes,
        "file_count": file_count,
        "size_truncated": truncated,
        "owner": _owner(path),
        "permissions": stat.filemode(st.st_mode),
        "mount_info": mount_info,
        "dependencies": [{"target": t, "label": l} for t, l in deps],
        "dependents": dependents,
        "safe_to_delete": safe_to_delete,
        "inspect_commands": _inspect_commands(path, is_dir, is_mount),
    }


def _inspect_commands(path, is_dir, is_mount):
    cmds = [
        f"xdg-open {path!r}",
        f"du -sh {path!r}",
        f"ls -la {path!r}" if is_dir else f"file {path!r}",
        f"rpm -qf {path!r}",
        f"stat {path!r}",
    ]
    if is_mount:
        cmds.append(f"umount {path!r}")
    return cmds
