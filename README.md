# VidFlow

VidFlow is a Chrome / Edge extension that detects and downloads videos from web pages (with a focus on HLS / `.m3u8`), with quality detection and a simple download manager.

## Usage

### Install (Load unpacked in Chrome / Edge)

- Chrome: open `chrome://extensions/`
- Edge: open `edge://extensions/`
- Enable **Developer mode**
- Click **Load unpacked** and select the folder that **contains `manifest.json`**

After loading, it typically appears as **“Video Download Helper”** in the extensions list.

> If you cloned from source and Chrome/Edge complains about missing files like `node_modules/@ffmpeg/...`, run `npm install` in the extension folder, then click **Reload** on the extensions page.

### Download a video

- Open a page with a video and start playing it (to trigger capture)
- Click the extension icon in the toolbar
- Click **Open Manager** (「打开管理器」)
- Select a quality (if available) and start downloading
- When it’s done, click **Save** to export an MP4

## What it does

- Detects HLS (`.m3u8`) and some direct MP4 links
- Auto-detects and normalizes quality labels (e.g. 480p / 720p / 1080p / 2k / 4k)
- Shows real-time progress and speed, supports pause/resume
- When needed, uses `ffmpeg.wasm` to remux TS streams into MP4 (locally)

## Limitations & notes

- YouTube is intentionally blocked; CCTV/CNTV are not supported
- DRM-protected content can’t be downloaded
- For educational and personal use only—respect website terms and copyright laws

## Repository

- `https://github.com/Sirius7Cangshu/VidFlow`
