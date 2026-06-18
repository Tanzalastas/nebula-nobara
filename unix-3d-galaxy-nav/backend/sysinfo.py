"""Detects distro, kernel, GPU, health, and storage facts about the running
machine. Uses psutil when available for nicer health stats, otherwise falls
back to /proc and stdlib.
"""

import getpass
import json
import os
import platform
import shutil
import socket
import subprocess
import time

try:
    import psutil
except ImportError:
    psutil = None

_BOOT_TIME = time.time() - float(open("/proc/uptime").read().split()[0]) if os.path.exists("/proc/uptime") else None


def _run(cmd, timeout=2.0):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if out.returncode == 0:
            return out.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    return None


def _os_release():
    info = {}
    for candidate in ("/etc/os-release", "/usr/lib/os-release"):
        if os.path.exists(candidate):
            with open(candidate) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    info[key] = value.strip('"')
            break
    return info


def _boot_mode():
    return "UEFI" if os.path.isdir("/sys/firmware/efi") else "BIOS (Legacy)"


def _uptime_str():
    try:
        seconds = float(open("/proc/uptime").read().split()[0])
    except OSError:
        return "unknown"
    days, rem = divmod(int(seconds), 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours or days:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    return " ".join(parts)


def _gpu_info():
    smi = _run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"])
    if smi:
        parts = [p.strip() for p in smi.split(",")]
        return {
            "name": parts[0] if parts else "unknown",
            "driver": parts[1] if len(parts) > 1 else "unknown",
            "memory": parts[2] if len(parts) > 2 else "unknown",
            "source": "nvidia-smi",
        }
    lspci = _run(["lspci"])
    if lspci:
        for line in lspci.splitlines():
            if "VGA" in line or "3D controller" in line:
                name = line.split(": ", 1)[-1]
                return {"name": name, "driver": "unknown", "memory": "unknown", "source": "lspci"}
    return {"name": "unknown", "driver": "unknown", "memory": "unknown", "source": "none"}


def _mem_info():
    if psutil:
        vm = psutil.virtual_memory()
        return {"total_bytes": vm.total, "used_bytes": vm.used, "percent": vm.percent}
    total = used = None
    fields = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, value = line.partition(":")
                fields[key.strip()] = int(value.strip().split()[0]) * 1024
    except OSError:
        return {"total_bytes": 0, "used_bytes": 0, "percent": 0}
    total = fields.get("MemTotal", 0)
    available = fields.get("MemAvailable", 0)
    used = max(0, total - available)
    percent = round(used / total * 100, 1) if total else 0
    return {"total_bytes": total, "used_bytes": used, "percent": percent}


def _disk_info(root="/"):
    usage = shutil.disk_usage(root)
    fstype = "unknown"
    try:
        with open("/proc/mounts") as f:
            best = None
            for line in f:
                parts = line.split()
                if len(parts) >= 3 and root.startswith(parts[1]):
                    if best is None or len(parts[1]) > len(best[1]):
                        best = parts
            if best:
                fstype = best[2]
    except OSError:
        pass
    return {
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "percent": round(usage.used / usage.total * 100, 1) if usage.total else 0,
        "filesystem": fstype,
    }


def get_system():
    os_release = _os_release()
    return {
        "distro": os_release.get("PRETTY_NAME", platform.platform()),
        "kernel": platform.release(),
        "arch": platform.machine(),
        "uptime": _uptime_str(),
        "user": getpass.getuser(),
        "hostname": socket.gethostname(),
        "boot_mode": _boot_mode(),
        "gpu": _gpu_info(),
        "ram": _mem_info(),
        "disk": _disk_info("/"),
    }


def get_health():
    if psutil:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        per_core = psutil.cpu_percent(interval=0.0, percpu=True)
        load = list(os.getloadavg())
        mem = _mem_info()
        temp = None
        try:
            temps = psutil.sensors_temperatures()
            for entries in temps.values():
                if entries:
                    temp = entries[0].current
                    break
        except (AttributeError, OSError):
            pass
        return {
            "cpu_percent": cpu_percent,
            "cpu_per_core": per_core,
            "load_avg": load,
            "memory": mem,
            "temperature_c": temp,
            "source": "psutil",
        }

    load = list(os.getloadavg())
    mem = _mem_info()
    temp = None
    thermal_root = "/sys/class/thermal"
    if os.path.isdir(thermal_root):
        for zone in sorted(os.listdir(thermal_root)):
            path = os.path.join(thermal_root, zone, "temp")
            if os.path.exists(path):
                try:
                    temp = int(open(path).read().strip()) / 1000.0
                    break
                except (OSError, ValueError):
                    continue
    return {
        "cpu_percent": None,
        "cpu_per_core": [],
        "load_avg": load,
        "memory": mem,
        "temperature_c": temp,
        "source": "proc",
    }


def get_storage():
    out = _run(["lsblk", "-J", "-O"]) or _run(["lsblk", "-J"])
    devices = []
    if out:
        try:
            devices = json.loads(out).get("blockdevices", [])
        except json.JSONDecodeError:
            devices = []

    subvolumes = []
    btrfs_list = _run(["btrfs", "subvolume", "list", "/"])
    if btrfs_list:
        for line in btrfs_list.splitlines():
            parts = line.split()
            if "path" in parts:
                idx = parts.index("path")
                subvolumes.append(" ".join(parts[idx + 1:]))

    return {"block_devices": devices, "btrfs_subvolumes": subvolumes}


def get_processes(limit=8):
    """Top processes by CPU usage, for the Active Processes HUD panel."""
    if psutil:
        # psutil.Process.cpu_percent() reports the delta since its *previous*
        # call on that same object, so a single fresh process_iter() pass
        # always reads 0.0. Prime each process once, wait briefly, then
        # sample again to get a real instantaneous reading.
        procs_raw = list(psutil.process_iter(["pid", "name", "username", "memory_percent"]))
        for p in procs_raw:
            try:
                p.cpu_percent(None)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        time.sleep(0.1)
        procs = []
        for p in procs_raw:
            try:
                info = p.info
                cpu = p.cpu_percent(None)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
            if info.get("name"):
                procs.append({
                    "pid": info["pid"],
                    "name": info["name"],
                    "user": info.get("username") or "?",
                    "cpu_percent": round(cpu, 1),
                    "memory_percent": round(info.get("memory_percent") or 0.0, 1),
                })
        procs.sort(key=lambda p: p["cpu_percent"], reverse=True)
        return {"processes": procs[:limit], "total": len(procs), "source": "psutil"}

    # /proc fallback: no per-process CPU% without two samples, so just list by name.
    procs = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/comm") as f:
                name = f.read().strip()
            procs.append({"pid": int(pid), "name": name, "user": "?", "cpu_percent": 0.0, "memory_percent": 0.0})
        except OSError:
            continue
    return {"processes": procs[:limit], "total": len(procs), "source": "proc"}
