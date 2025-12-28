# Video Download Helper

A modern Chrome extension for downloading videos from websites with multi-quality support and advanced detection capabilities.

## Features

✅ **Multi-Quality Detection**: Automatically detects and offers different video qualities for download
✅ **Universal Compatibility**: Works on virtually any website that serves video content
✅ **YouTube Protection**: Automatically blocks YouTube to comply with their terms of service
✅ **Modern UI**: Clean, responsive interface with progress indicators
✅ **Local Processing**: No external servers required - everything runs locally
✅ **Smart Detection**: Advanced video stream detection including HLS and DASH
✅ **Timeout Protection**: 20-second timeout mechanism prevents hanging
✅ **Progress Tracking**: Real-time download progress with speed and ETA indicators

## Installation

### From Source (Development)

1. Clone or download this repository
2. Generate icons by opening `icons/create_icons.html` in your browser and clicking "Generate Icons"
3. Download all the generated PNG files and place them in the `icons/` folder
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode" in the top right
6. Click "Load unpacked" and select the extension folder
7. The extension should now appear in your toolbar

### Manual Icon Creation

If the automatic icon generation doesn't work, you can create simple PNG files manually:
- Create `icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png` in the `icons/` folder
- Use any image editor to create simple icons (they can be simple colored squares for testing)

## How to Use

1. **Navigate to any website** with videos (except YouTube)
2. **Click the extension icon** in your Chrome toolbar
3. **Wait for video detection** - the extension will scan the page for video content
4. **Choose your preferred quality** from the detected videos
5. **Click "Download"** to start the download process
6. **Monitor progress** in the extension popup
7. **Find your downloaded videos** in Chrome's default download folder

## Supported Video Sources

- Direct video file links (.mp4, .webm, .ogg, etc.)
- HLS streams (.m3u8 playlists)
- DASH streams (.mpd manifests)
- Embedded video players (JWPlayer, Video.js, Plyr)
- Dynamic video content loaded via JavaScript
- Video elements with multiple source qualities

## Technical Architecture

### Core Components

- **Background Service Worker** (`js/background.js`): Handles downloads and cross-tab communication
- **Content Script** (`js/content.js`): Detects videos on web pages
- **Injected Script** (`js/injected.js`): Deep video detection within page context
- **Popup Interface** (`popup.html` + `js/popup.js`): User interface for managing downloads

### Video Detection Methods

1. **DOM Video Elements**: Scans for `<video>` tags and their sources
2. **Network Request Interception**: Monitors XHR/Fetch requests for video URLs
3. **Streaming Protocol Detection**: Identifies HLS (.m3u8) and DASH (.mpd) manifests
4. **Video Player Integration**: Hooks into popular video player APIs
5. **Dynamic Content Monitoring**: Watches for dynamically loaded video content

### Security & Privacy

- **No External Servers**: All processing happens locally on your machine
- **YouTube Compliance**: Automatically blocks YouTube domains to respect their ToS
- **Permission Minimal**: Only requests necessary permissions for core functionality
- **No Data Collection**: Extension doesn't collect or transmit any personal data

## Development

### Project Structure

```
Video_Download_Helper/
├── manifest.json              # Extension configuration
├── popup.html                 # Main UI interface
├── js/
│   ├── background.js          # Service worker for downloads
│   ├── content.js             # Page video detection
│   ├── injected.js            # Deep detection script
│   └── popup.js               # UI interaction logic
├── css/
│   ├── popup.css              # Custom styles
│   ├── tailwind.min.css       # UI framework
│   └── fontawesome.min.css    # Icon fonts
├── icons/                     # Extension icons
├── rules.json                 # Network request rules
└── README.md                  # This file
```

### Key Technologies

- **Manifest V3**: Latest Chrome extension API
- **Tailwind CSS**: Modern utility-first CSS framework
- **Font Awesome**: Comprehensive icon library
- **Vanilla JavaScript**: No external dependencies for maximum performance
- **Service Workers**: Modern background script architecture

### Testing & Debugging

1. **Enable Developer Mode** in Chrome extensions page
2. **Inspect Views**: Use "Inspect views: service worker" for background debugging
3. **Console Logging**: Check browser console for content script logs
4. **Network Tab**: Monitor video request detection in DevTools
5. **Storage Inspection**: Use Chrome DevTools to inspect extension storage

### Common Issues & Solutions

**No Videos Detected**
- Try refreshing the page
- Check browser console for JavaScript errors
- Ensure the website actually contains video content
- Some sites may load videos dynamically - wait a few seconds

**Download Fails**
- Check if the video URL is accessible
- Verify network connectivity
- Some videos may be protected or require authentication
- Try downloading a different quality if available

**Extension Not Loading**
- Verify all required files are present
- Check that icon files exist in the `icons/` folder
- Ensure manifest.json has no syntax errors
- Try reloading the extension in chrome://extensions/

## Browser Compatibility

- **Chrome**: Full support (Manifest V3)
- **Edge**: Full support (Chromium-based)
- **Firefox**: Not supported (different extension API)
- **Safari**: Not supported (different extension system)

## Legal Considerations

- This extension is designed to work with publicly accessible video content
- YouTube downloading is explicitly blocked to comply with their terms of service
- Users are responsible for ensuring they have the right to download video content
- Respect website terms of service and copyright laws
- This tool should not be used for piracy or copyright infringement

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on multiple websites
5. Submit a pull request with detailed description

## License

This project is open source and available under the MIT License.

## Changelog

### Version 1.0.0
- Initial release
- Multi-quality video detection
- Modern UI with progress tracking
- YouTube blocking mechanism
- HLS and DASH stream support
- Timeout protection and error handling

## Support

For issues, feature requests, or questions:
1. Check the common issues section above
2. Search existing issues on the repository
3. Create a new issue with detailed description and steps to reproduce
4. Include browser version and extension version information

---

**Note**: This extension is for educational and personal use. Always respect copyright laws and website terms of service when downloading content.
