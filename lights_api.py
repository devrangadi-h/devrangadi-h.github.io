#!/usr/bin/env python3
import json
import os
from flask import Flask, request, jsonify
import urllib.request
import urllib.error

API_KEY_PATH = "/home/polaris/.openclaw/credentials/govee_api_key"
GOVEE_OPENAPI_BASE = "https://openapi.api.govee.com/router/api/v1"

# Two H607C floor lamps from the OpenAPI devices list
LAMPS = [
    {"device": "47:1B:C7:56:0C:CB:07:80", "sku": "H607C"},
    {"device": "71:7B:DE:00:ED:28:99:A4", "sku": "H607C"},
]

app = Flask(__name__)


def load_api_key() -> str:
    try:
        with open(API_KEY_PATH, "r") as f:
            return f.read().strip()
    except OSError:
        raise RuntimeError(f"Govee API key file not found at {API_KEY_PATH}")


def govee_control(capability: dict):
    """Send a control command via Govee OpenAPI to all lamps.

    capability: {
      "type": "devices.capabilities.*",
      "instance": "...",
      "value": ...
    }
    """
    api_key = load_api_key()
    url = f"{GOVEE_OPENAPI_BASE}/device/control"
    headers = {
        "Govee-API-Key": api_key,
        "Content-Type": "application/json",
    }
    responses = []
    for idx, lamp in enumerate(LAMPS, start=1):
        payload = {
            "requestId": f"polaris-lights-{idx}",
            "payload": {
                "device": lamp["device"],
                "sku": lamp["sku"],
                "capability": capability,
            },
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                responses.append(json.loads(body))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            responses.append({"error": f"HTTP {e.code}", "body": body})
        except urllib.error.URLError as e:
            responses.append({"error": str(e)})
    return responses


@app.route("/api/lights/power", methods=["POST"])
def api_power():
    data = request.get_json(silent=True) or {}
    value = data.get("value")
    if value not in {"on", "off"}:
        return jsonify({"error": "value must be 'on' or 'off'"}), 400
    on_val = 1 if value == "on" else 0
    cap = {
        "type": "devices.capabilities.on_off",
        "instance": "powerSwitch",
        "value": on_val,
    }
    resp = govee_control(cap)
    return jsonify({"ok": True, "responses": resp})


@app.route("/api/lights/brightness", methods=["POST"])
def api_brightness():
    data = request.get_json(silent=True) or {}
    try:
        val = int(data.get("value"))
    except (TypeError, ValueError):
        return jsonify({"error": "value must be integer 1-100"}), 400
    if not (1 <= val <= 100):
        return jsonify({"error": "value must be 1-100"}), 400
    cap = {
        "type": "devices.capabilities.range",
        "instance": "brightness",
        "value": val,
    }
    resp = govee_control(cap)
    return jsonify({"ok": True, "responses": resp})


@app.route("/api/lights/preset", methods=["POST"])
def api_preset():
    data = request.get_json(silent=True) or {}
    preset = data.get("value")
    if preset == "bright_white_cool":
        caps = [
            {
                "type": "devices.capabilities.color_setting",
                "instance": "colorTemperatureK",
                "value": 6500,
            },
            {
                "type": "devices.capabilities.range",
                "instance": "brightness",
                "value": 100,
            },
        ]
    elif preset == "bright_white_warm":
        caps = [
            {
                "type": "devices.capabilities.color_setting",
                "instance": "colorTemperatureK",
                "value": 3000,
            },
            {
                "type": "devices.capabilities.range",
                "instance": "brightness",
                "value": 80,
            },
        ]
    else:
        return jsonify({"error": "unknown preset"}), 400

    all_responses = []
    for cap in caps:
        all_responses.append(govee_control(cap))
    return jsonify({"ok": True, "responses": all_responses})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
