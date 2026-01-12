# VidFlow — Project Summary

Repository: `https://github.com/Sirius7Cangshu/VidFlow`

VidFlow is a Chrome / Edge (Manifest V3) extension for detecting and downloading web videos (especially HLS / `.m3u8`) with basic quality detection and a download manager.

## Usage (user flow)

- Load the extension (Developer mode → Load unpacked)
- Open a page with a video and start playing it
- Click the extension icon → **Open Manager**
- Pick a quality (if available) → Download → **Save**

## What it does

- Detects HLS (`.m3u8`) streams and some direct MP4 links
- Extracts / normalizes resolution labels (e.g. 480p / 720p / 1080p / 2k / 4k)
- Download manager UI with progress + speed, supports pause/resume
- When needed, remuxes TS-based HLS to MP4 via `ffmpeg.wasm` (local processing)

## Limitations

- YouTube is intentionally blocked; CCTV/CNTV are not supported
- DRM-protected content can’t be downloaded
- If you load directly from source and see missing `node_modules/@ffmpeg/...` errors, run `npm install` then reload the extension

## Key files

- `manifest.json`: MV3 manifest
- `popup.html` / `js/popup.js`: toolbar popup
- `manager.html` / `js/manager.js`: download manager page
- `js/background.js`: service worker
- `js/content.js` / `js/injected.js`: detection hooks

