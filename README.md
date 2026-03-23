# devrobotics.dev — Portfolio & Polaris Dashboard

This repository backs **https://www.devrobotics.dev** and its subdomain **https://polaris.devrobotics.dev**.

- **Owner:** Hardik Devrangadi (Hardik)
- **Purpose:** Personal robotics portfolio site and Polaris activity dashboard
- **Hosting:** GitHub Pages
- **DNS / Edge:** Cloudflare
- **Automation / Assistant:** [OpenClaw](https://docs.openclaw.ai) running on a Raspberry Pi (agent name: **Polaris**)

## Polaris & Hardware Setup (High Level)

- **Raspberry Pi** (OpenClaw gateway host)
  - Runs the OpenClaw gateway and the *Polaris* agent
  - Has a local clone of this repo at `/home/polaris/devrobotics-site`
  - Can read and edit the site (HTML/CSS/JS) directly
  - Uses SSH keys + Git to commit and push changes back to GitHub
  - Runs additional services:
    - A Pi status updater (`update_pi_status.py`) that maintains `polaris-pi-status.json`
    - A flower snapshot pipeline (`update_flower_snapshot.sh`) triggered by systemd timers
    - A small lights control API (`lights_api.py`) for Govee floor lamps (H607C)

- **GitHub**
  - Stores the canonical source for the portfolio and dashboards
  - GitHub Pages publishes the static site

- **Cloudflare**
  - Fronts `devrobotics.dev` and `polaris.devrobotics.dev`
  - Will be used for Cloudflare Access on the private Polaris dashboard area

## Structure Overview

- `index.html` — main portfolio landing page (robotics background, projects, contact)
- `eclipse.html`, `objectdetection.html`, `opticalflow.html` — detailed project pages
- `polaris.html` — **public Polaris dashboard**
  - Shows the activity log of changes made by Polaris via `polaris-log.json`
  - Includes an overview section (latest change, Pi status widget, repo info)
  - Shows Pi and webcam status (Flower Tracker)
  - Contains a password-gated **Lighting Control** panel wired to the Pi lights API
- `polaris-log.json` — machine-readable log of changes Polaris makes to this repo
- `polaris-pi-status.json` — snapshot of Pi health (hostname, CPU temp/load, disk, OpenClaw status)
- `flower-tracker.json` + `images/flower-latest.jpg` — latest webcam snapshot + metadata
- `govee_lan.py` — local (LAN) control of Govee H607C floor lamps via UDP
- `govee_control.py` — helper for testing/using the Govee cloud API
- `lights_api.py` — Flask-based HTTP API on the Pi for lamp control
- `update_pi_status.py` — Pi status JSON generator (driven by cron/systemd)
- `update_flower_snapshot.sh` — webcam snapshot + JSON + Git push pipeline (driven by systemd timer)
- `private/` — **private Polaris dashboard** (to be gated by Cloudflare Access)
  - `private/index.html` — private dashboard shell + TODO section
- `assets/` & `images/` — styling, scripts, and media

## System Design: Site + Pi + Polaris (Simplified)

```text
Hardik ──(edits / approvals)─────────────────────────────┐
                                                         │
Raspberry Pi (OpenClaw + Polaris)                       │
  - Clone of repo: /home/polaris/devrobotics-site       │
  - Edits HTML/CSS/JS & polaris-log.json                │
  - Runs Pi status + flower snapshot + lights API       │
  - git add / commit / push via SSH                     │
                                                         │
GitHub (devrangadi-h/devrangadi-h.github.io)            │
  - Receives commits from Pi / Hardik                   │
  - GitHub Pages builds & serves static site            │
                                                         │
Cloudflare                                              │
  - DNS + proxy for devrobotics.dev + polaris.*         │
  - (Planned) Cloudflare Access for /private/*          │
                                                         │
Visitors                                                │
  - devrobotics.dev → portfolio                         │
  - polaris.devrobotics.dev/polaris.html → public log   │
  - polaris.devrobotics.dev/private/ → gated dashboard  │
```

In words:

1. **Polaris** (OpenClaw agent on the Pi) edits this repo when instructed (e.g., update copy, add dashboards, wire integrations).
2. It logs its own changes into `polaris-log.json` and commits/pushes via SSH.
3. GitHub Pages rebuilds and publishes the updated site.
4. Cloudflare fronts the domain(s) and will enforce access control for the private area.

## System Design: Pi Status Pipeline

Polaris maintains a public Pi health summary via a lightweight JSON file.

```text
[Pi] update_pi_status.py (cron/systemd)                 
  ├─ Reads host metrics (hostname, CPU temp, load, disk)
  ├─ Calls `openclaw gateway status` for short summary   
  ├─ Writes polaris-pi-status.json                      
  └─ git add/commit/push (if JSON changed)              

GitHub Pages                                           
  └─ Serves polaris-pi-status.json along with HTML      

polaris.html                                            
  └─ JS fetch('polaris-pi-status.json')                  
     ├─ Renders Pi Status card                          
     └─ Shows Online indicator + metrics + timestamp    
```

Key properties:

- No heavy monitoring; just a small JSON snapshot.
- Public status hides sensitive details (no raw IPs or full command output).
- Updates are driven by the Pi itself, then propagated via GitHub Pages.

## System Design: Flower Tracker (Webcam + systemd timer)

Polaris exposes a simple webcam-based “Flower Tracker” section on the dashboard.

```text
systemd: flower-tracker.timer (every 5 minutes)
  └─ Runs flower-tracker.service (oneshot)
      └─ ExecStart=/home/polaris/devrobotics-site/update_flower_snapshot.sh

update_flower_snapshot.sh
  ├─ Uses ffmpeg to capture one frame from /dev/video0  
  │    → images/flower-latest.jpg.tmp                  
  ├─ Moves tmp → images/flower-latest.jpg              
  ├─ Writes flower-tracker.json                        
  │    { lastUpdated: ISO8601, image: path }           
  ├─ git add flower-tracker.json images/flower-latest.jpg
  ├─ git commit -m "Update flower tracker snapshot (auto)"
  └─ git push origin main (best-effort)                 

GitHub Pages                                           
  └─ Serves flower-tracker.json and images/flower-latest.jpg

polaris.html                                           
  └─ JS fetch('flower-tracker.json')                   
     ├─ Loads latest image                             
     └─ Shows "Last updated" in human-readable form   
```

Key properties:

- systemd timers are used instead of cron for better reliability and logging.
- The snapshot pipeline is hardened: temp-file handling, explicit PATH, and clear logging.
- The public site shows the latest snapshot and timestamp without exposing internal paths.

## System Design: Govee H607C Floor Lamps (Cloud + LAN)

Two Govee H607C floor lamps are integrated via both Govee’s cloud API and local LAN control.

```text
               ┌───────────────────────────────┐
               │ Govee Cloud OpenAPI          │
               │  - /router/api/v1/user/devices
               │  - /router/api/v1/device/control
               └──────────────┬────────────────┘
                              │
                   (HTTPS with API key)
                              │
Pi: lights_api.py (Flask)     │
  - /api/lights/power         │
  - /api/lights/brightness    │
  - /api/lights/preset        │
                              │
Pi: govee_lan.py (UDP 4003)   │ (fallback)
  - On/Off/Brightness/Color   │
                              │
polaris.html Lighting Control ┘
  - Password-gated panel
  - Buttons → fetch() to Pi API
```

Capabilities Polaris can drive:

- **Cloud (primary)**
  - Turn both H607C lamps on/off (`powerSwitch`).
  - Set brightness (1–100).
  - Set RGB color (`colorRgb`).
  - Set color temperature (`colorTemperatureK`, e.g. 6500K for bright cool white, 3000K for warm white).
- **LAN (fallback)**
  - Direct UDP control to `10.0.0.197` and `10.0.0.253` on port 4003 for on/off, brightness, and RGB.

## System Design: Polaris Lighting Control Panel (Dashboard)

The public Polaris dashboard includes a small, password-gated "Lighting Control" panel:

```text
User browser (devrobotics.dev/polaris.html)
  ├─ Unlocks panel with password (polarisrocks)
  ├─ Clicks buttons: On/Off, bright white (cool/warm), 25/50/75/100% brightness
  └─ JS fetch() → http://polaris.tailaf1119.ts.net:5000/api/lights/...

Pi: lights_api.py (Flask, systemd service)
  ├─ /api/lights/power      → calls Govee OpenAPI powerSwitch
  ├─ /api/lights/brightness → calls Govee OpenAPI brightness
  └─ /api/lights/preset     → maps to colorTemperatureK + brightness presets

Govee Cloud
  └─ Applies commands to both H607C lamps

Lamps (H607C floor lamps)
  └─ Respond with color/brightness changes in the room
```

Notes:

- The password gate is **front-end only** (not real security); true protection comes from network access (only devices that can reach the Pi API can control the lamps).
- The API key for Govee remains on the Pi; it is never exposed in browser JavaScript.
- A future TODO is to expose the Pi lights API through a public HTTPS endpoint (e.g., nginx reverse proxy) with rate limiting and a kill switch so anyone on the internet can play with the lamps safely.

## Current TODOs / Future Work

- **Public lights control via HTTPS**
  - Expose `lights_api.py` through a secure public endpoint (e.g., `lights.devrobotics.dev` behind nginx or Cloudflare/Tailscale), with:
    - Proper TLS
    - Basic rate limiting
    - A simple “kill switch” to disable public control if needed
  - Update `polaris.html` to call this HTTPS endpoint instead of the tailnet URL.

- **Private Polaris dashboard (/private)**
  - Finish wiring the private dashboard with Cloudflare Access.
  - Move more sensitive controls (logs, debug panels) behind the private area.

- **Pi/Flower health badges**
  - Add small “freshness” indicators showing if Pi status or flower snapshots are stale.

- **Lighting scenes**
  - Add named scenes (focus, chill, movie mode, night) with specific brightness + color temperature presets.

## Process Flow for Changes Managed by Polaris

1. Hardik requests a change (e.g., “tweak hero copy”, “add lighting control”, “tune Pi status panel”).
2. Polaris edits the relevant files in `/home/polaris/devrobotics-site` on the Pi.
3. Polaris updates `polaris-log.json` with a new entry describing the change.
4. Polaris commits the change with a descriptive message and pushes to `main`.
5. GitHub Pages deploys; Polaris sanity-checks the live site (layout, functionality).
6. The public Polaris dashboard (`polaris.html`) reflects the new log entry and updated behavior.

---

⚠️ **Note:** This README was drafted and is maintained by the **Polaris** agent running on the Raspberry Pi via OpenClaw, based on instructions from Hardik.
