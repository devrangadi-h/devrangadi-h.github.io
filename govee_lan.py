#!/usr/bin/env python3
import json
import socket
import sys

LAMP_IPS = [
    "10.0.0.197",
    "10.0.0.253",
]

UDP_PORT = 4003  # per Govee LAN API docs for control


def send_cmd(ip: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(2.0)
    try:
        sock.sendto(data, (ip, UDP_PORT))
    finally:
        sock.close()


def turn_all(on: bool):
    value = 1 if on else 0
    payload = {
        "msg": {
            "cmd": "turn",
            "data": {"value": value},
        }
    }
    for ip in LAMP_IPS:
        send_cmd(ip, payload)


def set_brightness_all(level: int):
    level = max(1, min(100, level))
    payload = {
        "msg": {
            "cmd": "brightness",
            "data": {"value": level},
        }
    }
    for ip in LAMP_IPS:
        send_cmd(ip, payload)


def set_color_all(r: int, g: int, b: int):
    r = max(0, min(255, r))
    g = max(0, min(255, g))
    b = max(0, min(255, b))
    payload = {
        "msg": {
            "cmd": "color",
            "data": {"r": r, "g": g, "b": b},
        }
    }
    for ip in LAMP_IPS:
        send_cmd(ip, payload)


def main(argv):
    if len(argv) < 2:
        print("Usage: govee_lan.py on|off|bright <1-100>|color <r> <g> <b>", file=sys.stderr)
        return 1
    cmd = argv[1]
    if cmd == "on":
        turn_all(True)
    elif cmd == "off":
        turn_all(False)
    elif cmd == "bright" and len(argv) >= 3:
        set_brightness_all(int(argv[2]))
    elif cmd == "color" and len(argv) >= 5:
        set_color_all(int(argv[2]), int(argv[3]), int(argv[4]))
    else:
        print("Usage: govee_lan.py on|off|bright <1-100>|color <r> <g> <b>", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
