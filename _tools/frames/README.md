# Frames pipeline

Turns the private Inbox (`/home/polaris/frames-inbox`, format in its `README.md`) into the published Frames section: processed media, `frames.json`, the grid inside `frames.html`, and `frames/<slug>.html` story pages. Jekyll skips `_tools/`, so none of this is served. No secrets live here.

## Image hosting (once): Cloudflare R2

Published media lives in the R2 bucket `frames`, served at `https://frames.devrobotics.dev` (see `_docs/adr/0001-frames-images-on-cloudflare-r2.md`). Run the wizard from an interactive terminal on the Pi (for example over `ssh polaris@polaris`):

```sh
_tools/frames/setup-r2.sh
```

It walks through enabling R2, creating the bucket, connecting the domain, the CORS policy and an API token, then writes the `frames-r2` rclone remote (keys only in rclone's config, `chmod 600`) and verifies an upload and a public read. Safe to re-run.

## Setup (once per machine)

```sh
_tools/frames/setup.sh
```

Installs `exiftool`, `heif-enc`/libheif (HEVC decode + encode), `rclone`, `ffmpeg`, and a Python venv at `/home/polaris/frames-tools/.venv` (outside the repo; override with `FRAMES_VENV=`) with the pinned packages in `requirements.txt` (Pillow, pillow-heif, numpy). `frames.py`'s shebang points at that venv.

## Commands (run from the repo root)

| Command | What it does |
| --- | --- |
| `_tools/frames/frames.py validate [--inbox DIR]` | Reads every non-`_` folder in `photos/` and `stories/` and lists **all** problems with file and line. Exits 1 on any error. Warnings (unused files, empty Note) don't block. |
| `_tools/frames/frames.py build [--inbox DIR] [--media-base URL] [--out-media DIR]` | Validates, then processes media into `_media/frames/` (git-ignored), writes `frames.json`, fills `<!-- frames:stats -->` and `<!-- frames:grid -->` in `frames.html` (only between the markers; fails if they're missing), renders `frames/<slug>.html` from `story.template.html`. Default media base `/_media/frames` = local preview. |
| `_tools/frames/frames.py upload [--dry-run] [--prune] [--remote frames-r2:frames]` | Copies the media dir to R2 with rclone. Never deletes. `--prune` deletes remote files the current build no longer uses; run it only **after** the new pages are pushed and live. |
| `_tools/frames/frames.py publish [--dry-run]` | `build --media-base https://frames.devrobotics.dev`, then `upload`. |

Other options: `--repo DIR` (write into another worktree, e.g. a scratch copy), `--jobs N` (parallel photos, default 3).

Publishing order (see the Inbox README): `validate` → `build` → Hardik checks `http://<pi>:8765/frames.html` → `publish` → commit `frames.json`, `frames.html`, `frames/*.html` → push → optionally `upload --prune`.

## What happens to each file

**Photos (JPEG):** the `full` file is the original with metadata stripped **losslessly**. The compressed image data is copied byte for byte, and the build decodes the original and the result and refuses to publish if a single pixel differs. Kept: ICC colour profile, Adobe APP14, minimal JFIF, and an HDR gain map if there is one: Ultra HDR / Adobe `hdrgm`, ISO 21496-1, or Apple's `HDRGainMap` (the MPF index is rebuilt with new offsets, the GContainer XMP lengths are recomputed, and only gain-map XMP fields are kept). Dropped: Exif (GPS, serial numbers, thumbnail, maker notes), XMP, IPTC, comments, MPF preview images, and trailing vendor data. Then Exif is written back with only `Artist = Hardik Devrangadi`, `Copyright = © Hardik Devrangadi`, and the original `Orientation` tag. Browsers honour that tag, so the file isn't re-encoded to rotate it.

**Photos (HEIC):** decoded once (rotation applied) and saved as JPEG q95, 4:4:4, with the ICC profile. A Display P3 profile is generated if the HEIC only signals P3 through nclx. If the HEIC has an Apple HDR gain map *and* the Apple headroom maker notes (`HDRHeadroom`/`HDRGain`), the result is an **Ultra HDR JPEG**: the gain map is re-expressed with Apple's documented formula as an `hdrgm` log2 map plus MPF. Otherwise the result is SDR and the build prints `HDR fallback: <file>: <reason>`. `hdr` in `frames.json` is true only when `full` really carries a gain map.

**Sizes:** `w2560` (WebP q90) and `w1280` (WebP q85): uncropped, long edge 2560 / 1280, Lanczos. `sq960` (q85) and `sq480` (q88): square crops centred on `focus`, clamped inside the image. Nothing is ever upscaled: a smaller original keeps its size. WebP files carry the source ICC profile and nothing else, so Display P3 photos keep their colours.

**Clips:** H.264 high profile, CRF 22, no audio, `+faststart`, metadata and location removed, long edge ≤ 1280. If the result is over 3 MB it's re-encoded in two passes to fit. HLG/PQ (iPhone HDR video) is tone-mapped to BT.709. The poster is the first frame as WebP. Clips over 10 s fail validation.

**Shot details** come from exiftool. GPS is only included when the `.md` doesn't say `gps: hide`, and it never reaches any published file.

## File names and caching

Every media file name has a short content hash: `kyoto-rain/w2560-4bfcc74669.webp`, `my-story/bamboo/full-85dcb93bf5.jpg`, `my-story/river-b723476778.mp4` (+ `-poster.webp`). The hash is `sha256(pipeline version | size name | recipe (e.g. focus) | sha256 of the original)`, so:

- A changed original, changed `focus`, or a pipeline change (bump `PIPELINE_VERSION` in `framespipe/build.py`) gives new names. `frames.json` and the HTML always point at the current names, so R2 can serve everything with `Cache-Control: public, max-age=31536000, immutable`.
- Names are deterministic. Rebuilding on another machine, or with the live media base, gives the same names.

`frames.json` is the source of truth for paths (relative to `mediaBase`).

## Incremental builds

`_media/frames/.manifest.json` records each source's SHA-256 and the outputs it produced. An unchanged source whose outputs exist is skipped (a rebuild of 16 files takes about 0.6 s). A changed `focus` re-renders only the two squares. Media for deleted Inbox entries is removed from the media dir, and generated story pages for deleted stories are removed from `frames/`. Pages are recognised by the `Generated by _tools/frames` comment, so hand-written files are never touched. Deleting `_media/frames` forces a full rebuild.

## R2 (not set up yet)

The lead will run a one-time setup wizard. It needs to create an rclone remote named **`frames-r2`** (type `s3`, provider `Cloudflare`, the R2 access key and secret, endpoint `https://<account-id>.r2.cloudflarestorage.com`, `acl = private`), with bucket **`frames`** connected to the custom domain `frames.devrobotics.dev`. The credentials stay in `~/.config/rclone/rclone.conf` on the Pi and never go in this repo. `upload` stops with a clear message until that remote exists. Uploads set `Content-Type` per extension (`image/webp`, `image/jpeg`, `video/mp4`) and the immutable `Cache-Control` above, and pass `--s3-no-check-bucket` so a bucket-scoped token is enough. To test without R2, use a local alias: `printf '[frames-r2]\ntype = alias\nremote = /tmp/r2\n' > /tmp/rc.conf; RCLONE_CONFIG=/tmp/rc.conf _tools/frames/frames.py upload --dry-run`.

## Layout

```text
_tools/frames/
├── frames.py              CLI
├── framespipe/
│   ├── inbox.py           .md parsing, markers, folder validation
│   ├── shot.py            exiftool → Shot details
│   ├── jpeg.py            lossless strip, MPF/gain map, Ultra HDR assembly
│   ├── images.py          HEIC, WebP sizes, crops
│   ├── icc.py             Display P3 ICC writer
│   ├── clips.py           ffmpeg
│   ├── md.py              safe Markdown subset
│   ├── render.py          grid / stats / story HTML
│   ├── build.py           validate + build orchestration, cache
│   └── upload.py          rclone
├── story.template.html    story page template (owned by the story page work)
├── setup.sh, requirements.txt
```
