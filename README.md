# Video Download Helper

A powerful Chrome/Edge extension for downloading HLS (.m3u8) videos with accurate resolution detection and modern UI.

## ✨ Features

### Core Functionality
- 🎬 **HLS Video Download**: Download m3u8 streaming videos and convert to MP4
- 📊 **Accurate Resolution Detection**: Parse MP4 `tkhd` box and HLS master playlist for real resolution
- 🎯 **Standard Quality Labels**: Auto-normalize to 480p/720p/1080p/2k/4k
- ⚡ **Real-time Speed Display**: Monitor download speed during transfer
- 📦 **Range Download Support**: Multi-threaded chunked downloads for large files

### User Experience
- 🎨 **Nordic-style UI**: Clean, modern interface with centered progress bar
- 📋 **One-click Copy**: Copy video URL with a single click
- 🔄 **Auto Resolution Select**: Automatically populate quality dropdown
- 💾 **Manual Save Control**: Download completes, you decide when to save
- 🧹 **Smart Cache Management**: Clear cache on page refresh

### Technical Highlights
- 🔒 **YouTube Blocked**: Complies with YouTube ToS
- 🚫 **CCTV/CNTV Blocked**: These sites are not supported
- 🎞️ **FFmpeg Remux**: TS to MP4 conversion via ffmpeg.wasm
- 📡 **fMP4/CMAF Support**: Direct concatenation for fragmented MP4

## 📦 Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/Video_Download_Helper.git
   ```

2. Open Chrome/Edge and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right)

4. Click **Load unpacked** and select the extension folder

5. The extension icon should appear in your toolbar

## 🚀 How to Use

### Quick Start

1. **Navigate** to a website with HLS video (not YouTube/CCTV)
2. **Play the video** to trigger stream capture
3. **Click the extension icon** in toolbar
4. **Click "打开管理器"** (Open Manager) to enter download page
5. **Select resolution** from dropdown (if multiple available)
6. **Wait for download** to complete (progress bar shows %)
7. **Click "保存"** (Save) to download the MP4 file

### Manager Page Features

| Feature | Description |
|---------|-------------|
| Resolution Dropdown | Select video quality (auto-detected from stream) |
| Progress Bar | Shows download progress with percentage inside |
| Speed Display | Real-time download speed (e.g., "11 MB/s") |
| Copy Button | Copy video URL to clipboard |
| Pause/Resume | Pause and resume download |
| Clear Cache | Remove all cached data |
| Concurrency Control | Adjust parallel request count (1-3) |

## 🎯 Supported Sources

| Type | Support |
|------|---------|
| HLS (.m3u8) | ✅ Full support |
| MP4 Direct Link | ✅ Full support |
| fMP4/CMAF | ✅ Full support |
| DASH (.mpd) | ⚠️ Limited |
| YouTube | ❌ Blocked |
| CCTV/CNTV | ❌ Blocked |

## 🏗️ Technical Architecture

### Project Structure

```
Video_Download_Helper/
├── manifest.json          # Extension manifest (MV3)
├── popup.html             # Popup interface
├── manager.html           # Download manager page
├── js/
│   ├── background.js      # Service worker
│   ├── content.js         # Page video detection
│   ├── injected.js        # Deep detection script
│   ├── popup.js           # Popup logic
│   ├── manager.js         # Manager page logic
│   └── utils.js           # Utility functions
├── css/
│   ├── popup.css          # Popup styles
│   ├── manager.css        # Manager styles
│   └── tailwind.min.css   # Tailwind CSS
├── icons/                 # Extension icons
└── node_modules/
    └── @ffmpeg/           # FFmpeg.wasm for remuxing
```

### Resolution Detection Flow

```
1. Capture video URL via webRequest API
2. For HLS:
   - Parse master playlist for RESOLUTION=WxH
   - Extract height and normalize to standard label
3. For MP4:
   - Range request to fetch moov/tkhd box
   - Read width/height from tkhd
   - Normalize to standard label (720p, 1080p, etc.)
4. Display in resolution dropdown
```

### Quality Normalization

| Height Range | Label |
|--------------|-------|
| ≥ 2160 | 4k |
| ≥ 1440 | 2k |
| ≥ 1080 | 1080p |
| ≥ 720 | 720p |
| ≥ 480 | 480p |
| ≥ 360 | 360p |
| ≥ 240 | 240p |

## 🔧 Development

### Prerequisites

- Node.js (for package management)
- Chrome/Edge browser
- Basic knowledge of Chrome Extension APIs

### Local Development

```bash
# Install dependencies (for ffmpeg.wasm)
npm install

# Load extension in browser
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Load unpacked → select project folder
```

### Debugging

- **Service Worker**: Click "Inspect views: service worker" in extensions page
- **Manager Page**: Open DevTools (F12) on the manager page
- **Content Script**: Check console on the video page

## 📋 Changelog

### v1.1.0 (Latest)
- ✅ Accurate MP4 resolution detection via tkhd box parsing
- ✅ HLS master playlist RESOLUTION parsing
- ✅ Normalize resolutions to standard labels (480p/720p/1080p/2k/4k)
- ✅ Map 1440p to "2k" per CN convention
- ✅ Move copy button to title row, remove URL display
- ✅ Widen progress bar (22px height, 92% width)
- ✅ Center progress bar with percentage inside
- ✅ Real-time download speed display
- ✅ Fix click handler to prevent re-download
- ✅ Auto-select first video and populate resolution dropdown
- ✅ Remove auto-save, require manual save
- ✅ Clear cache on page refresh
- ✅ Remove usage instructions section

### v1.0.0
- Initial release
- HLS/m3u8 video download
- MP4 direct link download
- Basic resolution detection from URL
- Progress tracking

## ⚖️ Legal Notice

- This extension is for **educational and personal use only**
- YouTube downloading is **blocked** to comply with their ToS
- Users are responsible for ensuring they have rights to download content
- Respect copyright laws and website terms of service
- **Do not use for piracy or copyright infringement**

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is open source under the [MIT License](LICENSE).

---

**Made with ❤️ for video enthusiasts**
