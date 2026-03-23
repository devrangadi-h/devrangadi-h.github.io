#!/usr/bin/env python3
import json
import os
import socket
import subprocess
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
STATUS_PATH = os.path.join(ROOT, "polaris-pi-status.json")


def read_cpu_temp_c():
    """Return CPU temperature in °C as float, or None if unavailable."""
    # Common Raspberry Pi path
    candidates = [
        "/sys/class/thermal/thermal_zone0/temp",
        "/sys/class/hwmon/hwmon0/temp1_input",
    ]
    for path in candidates:
        try:
            with open(path, "r") as f:
                raw = f.read().strip()
            # Most Pi kernels expose temp in millidegrees C
            value = float(raw)
            if value > 1000:
                return round(value / 1000.0, 1)
            return round(value, 1)
        except (FileNotFoundError, ValueError, OSError):
            continue
    return None


def read_load():
    """Return load averages and a rough CPU utilization percent.

    CPU % is derived as load1 / cpu_count * 100 and capped at 400% on a 4-core system
    (i.e., 100% per core). This is an approximation but more intuitive than raw load.
    """
    try:
        load1, load5, load15 = os.getloadavg()
        cpu_count = os.cpu_count() or 1
        cpu_pct = min(max(load1 / cpu_count * 100.0, 0.0), 100.0)
        return {
            "load1": round(load1, 2),
            "load5": round(load5, 2),
            "load15": round(load15, 2),
            "cpuPercent": round(cpu_pct, 1),
        }
    except (OSError, ValueError):
        return {}


def read_disk_root():
    try:
        # Use `df -h /` and parse the second line
        out = subprocess.check_output(["df", "-h", "/"], text=True)
        lines = out.strip().splitlines()
        if len(lines) < 2:
            return None
        parts = lines[1].split()
        if len(parts) < 5:
            return None
        size, used, avail, percent = parts[1:5]
        return f"{used}/{size} ({percent})"
    except (subprocess.SubprocessError, OSError):
        return None


def read_memory():
    """Return memory usage as a friendly string, or None on failure."""
    try:
        out = subprocess.check_output(["free", "-h"], text=True)
    except (subprocess.SubprocessError, OSError):
        return None

    lines = out.strip().splitlines()
    # Look for the line that starts with "Mem:" (standard on Linux)
    for line in lines:
        if not line.lower().startswith("mem"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        # total, used, free, ...
        total, used = parts[1], parts[2]
        return f"{used}/{total}"
    return None


def read_openclaw_status():
    """Return a short OpenClaw status string, or None on failure.

    We keep this intentionally simple to avoid depending on specific output formats.
    """
    try:
        out = subprocess.check_output(["openclaw", "gateway", "status"], text=True, stderr=subprocess.STDOUT)
    except (subprocess.SubprocessError, OSError):
        return None

    # Very rough parsing for a short, non-sensitive summary.
    # We intentionally avoid exposing IP addresses or full command lines.
    runtime = None
    gateway = None
    for line in out.splitlines():
        t = line.strip()
        if t.startswith("Runtime:"):
            runtime = t.replace("Runtime:", "").strip()
        if t.startswith("Gateway:"):
            gateway = t.replace("Gateway:", "").strip()

    if not runtime and not gateway:
        return None

    # Collapse details to a simple health string.
    pieces = []
    if runtime:
        pieces.append(runtime.split(",")[0])  # e.g., "running (pid ...)" → "running (pid ...)" then trimmed below
    if gateway:
        pieces.append(gateway.split(",")[0])  # e.g., "bind=tailnet (...)" → "bind=tailnet (...)" then trimmed below

    summary = " | ".join(pieces)
    # Strip anything in parentheses to avoid leaking IPs/PIDs.
    import re
    summary = re.sub(r"\s*\([^)]*\)", "", summary).strip()
    return summary or None


def build_status():
    now = datetime.now(timezone.utc).astimezone()  # local time with tz
    data = {
        "piOnline": True,
        "hostname": socket.gethostname(),
        "lastUpdated": now.isoformat(timespec="seconds"),
    }

    temp = read_cpu_temp_c()
    if temp is not None:
        data["cpuTempC"] = temp

    load = read_load()
    data.update(load)

    disk = read_disk_root()
    if disk is not None:
        data["diskRoot"] = disk

    mem = read_memory()
    if mem is not None:
        data["memory"] = mem

    oc_status = read_openclaw_status()
    if oc_status is not None:
        data["openclawStatus"] = oc_status

    return data


def write_status_file(status):
    tmp_path = STATUS_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(status, f, indent=2)
    os.replace(tmp_path, STATUS_PATH)


def git_has_changes():
    try:
        subprocess.check_call(["git", "diff", "--quiet"], cwd=ROOT)
        return False
    except subprocess.CalledProcessError:
        return True


def git_commit_and_push():
    if not git_has_changes():
        return
    msg = "Update Polaris Pi status (auto)"
    subprocess.check_call(["git", "add", "polaris-pi-status.json"], cwd=ROOT)
    subprocess.check_call(["git", "commit", "-m", msg], cwd=ROOT)
    subprocess.check_call(["git", "push", "origin", "main"], cwd=ROOT)


def main():
    status = build_status()
    write_status_file(status)
    try:
        git_commit_and_push()
    except subprocess.SubprocessError as e:
        # For safety, don't crash if git/SSH is misconfigured.
        print(f"Warning: git commit/push failed: {e}")


if __name__ == "__main__":
    main()
