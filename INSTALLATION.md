# VidFlow — Load the Extension (Chrome / Edge)

VidFlow is a browser extension. You don’t “install” it like a desktop app—typically you **load it as an unpacked extension** in Developer Mode.

## Load unpacked (recommended)

1. Get the source:

```bash
git clone https://github.com/Sirius7Cangshu/VidFlow.git
cd VidFlow
```

2. Open the extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the folder that contains `manifest.json`

> In the extensions list it may appear as **“Video Download Helper”** (the current manifest name).

## If it fails to load

If the error mentions missing files like `node_modules/@ffmpeg/...`, run:

```bash
npm install
```

in the extension folder, then click **Reload** on the extensions page.

## Quick check

Open `test.html`, play the sample video, then click the extension icon to verify it detects the video.
