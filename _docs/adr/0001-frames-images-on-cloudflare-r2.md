# Frames images live on Cloudflare R2, not in the site repo

Frames needs full-resolution Photos (often 3–10 MB each) served without visible quality loss, but every file committed to the GitHub Pages repo stays in git history forever, and the repo is already ~136 MB against Pages' ~1 GB soft limit. So the published Photo files (grid sizes, a 2560 px lightbox size and the full-resolution file) are uploaded to a Cloudflare R2 bucket served at `frames.devrobotics.dev`, while the repo holds only the HTML and the Frames data file. R2 was chosen over keeping images in the repo (git bloat), a second GitHub repo (same bloat, moved) and Cloudflare Images (monthly cost) because it is free at this scale, has no egress fees, and the domain is already on Cloudflare.

## Consequences

- Publishing needs R2 credentials on the Pi (one-time setup); without them, Photos cannot go live.
- Originals in the Inbox are never published as-is: metadata is stripped (losslessly for JPEG) and only the copyright and Hardik's name are written back; Shot details reach the site through the data file, with GPS omitted when a Photo says `gps: hide`.
