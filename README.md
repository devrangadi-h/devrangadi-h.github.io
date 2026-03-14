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
- `polaris-log.json` — machine-readable log of changes Polaris makes to this repo
- `private/` — **private Polaris dashboard** (to be gated by Cloudflare Access)
  - `private/index.html` — private dashboard shell + TODO section
- `assets/` & `images/` — styling, scripts, and media

## System Design (Simplified)

```text
Hardik ──(edits / approvals)─────────────────────────────┐
                                                         │
Raspberry Pi (OpenClaw + Polaris)                       │
  - Clone of repo: /home/polaris/devrobotics-site       │
  - Edits HTML/CSS/JS & polaris-log.json                │
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

1. **Polaris** (OpenClaw agent on the Pi) edits this repo when instructed (e.g., update copy, add dashboards).
2. It logs its own changes into `polaris-log.json` and commits/pushes via SSH.
3. GitHub Pages rebuilds and publishes the updated site.
4. Cloudflare fronts the domain(s) and will enforce access control for the private area.

## Process Flow for Changes Managed by Polaris

1. Hardik requests a change (e.g., "tweak hero copy", "add a dashboard panel").
2. Polaris edits the relevant files in `/home/polaris/devrobotics-site` on the Pi.
3. Polaris updates `polaris-log.json` with a new entry describing the change.
4. Polaris commits the change with a descriptive message and pushes to `main`.
5. GitHub Pages deploys; Polaris sanity-checks the live site (layout, functionality).
6. The public Polaris dashboard (`polaris.html`) reflects the new log entry.

This README is intentionally high-level and describes the architecture so future contributors (or future Polaris) understand how the portfolio, Pi, and OpenClaw fit together.