#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
import urllib.error

API_BASE = "https://developer-api.govee.com/v1"

CRED_PATH = os.path.expanduser("/home/polaris/.openclaw/credentials/govee_api_key")


def load_api_key():
    try:
        with open(CRED_PATH, "r") as f:
            return f.read().strip()
    except OSError:
        print("Error: Govee API key file not found at", CRED_PATH, file=sys.stderr)
        sys.exit(1)


def api_request(path, method="GET", payload=None):
    api_key = load_api_key()
    url = API_BASE + path
    data = None
    headers = {
        "Govee-API-Key": api_key,
        "Content-Type": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print("HTTP error", e.code, body, file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print("Request error", e, file=sys.stderr)
        sys.exit(1)


def list_devices():
    resp = api_request("/devices")
    return resp


def main():
    if len(sys.argv) == 1 or sys.argv[1] == "list":
        devices = list_devices()
        print(json.dumps(devices, indent=2))
    else:
        print("Usage: govee_control.py [list]", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
