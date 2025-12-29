// Video Download Helper - Content Script
// Detects videos on web pages and communicates with popup/background

class VideoDetector {
	constructor() {
		this.videos = new Map();
		this.observers = [];
		this.requestInterceptor = null;
		this.init();
	}

	init() {
		// Don't run on YouTube
		if (this.isYouTubeSite()) {
			console.log('Video Download Helper: YouTube detected, extension disabled');
			return;
		}

		this.ensureInjectedScript();
		this.setupInjectedMessageBridge();

		this.setupVideoDetection();
		this.setupMessageHandler();
		this.startDetection();

		console.log('Video Download Helper: Content script initialized');
	}

	isYouTubeSite() {
		return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(window.location.hostname);
	}

	ensureInjectedScript() {
		chrome.runtime.sendMessage({ action: 'ensureInjected' }, () => {
			// Ignore injection errors on restricted pages
		});
	}

	setupInjectedMessageBridge() {
		window.addEventListener('message', (event) => {
			if (event.source !== window) {
				return;
			}

			if (!event.data || event.data.type !== 'VIDEO_DETECTED') {
				return;
			}

			this.handleInjectedVideoDetected(event.data.data);
		});
	}

	handleInjectedVideoDetected(data) {
		if (!data || !data.url) {
			return;
		}

		const resolvedUrl = this.resolveUrl(data.url, window.location.href);
		if (!resolvedUrl) {
			return;
		}

		for (const existing of this.videos.values()) {
			if (existing.src === resolvedUrl) {
				return;
			}
		}

		const id = `injected-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		const videoInfo = {
			id,
			src: resolvedUrl,
			title: data.title || this.extractTitleFromPage(),
			quality: this.extractQualityFromUrl(resolvedUrl) || 'unknown',
			type: 'network-detected',
			detectedAt: data.timestamp || Date.now()
		};

		this.videos.set(id, videoInfo);
		this.notifyVideoDetected(videoInfo);
	}

	setupVideoDetection() {
		// Detect existing video elements
		this.detectVideoElements();

		// Watch for new video elements
		this.setupDOMObserver();

		// Detect video streams in network requests
		this.setupNetworkObserver();
	}

	detectVideoElements() {
		const videoElements = document.querySelectorAll('video');

		videoElements.forEach((video, index) => {
			this.analyzeVideoElement(video, `video-${index}`);
		});

		// Also look for embedded videos in iframes
		this.detectIframeVideos();
	}

	analyzeVideoElement(videoElement, id) {
		try {
			const videoInfo = {
				id: id,
				src: videoElement.src || videoElement.currentSrc,
				poster: videoElement.poster,
				duration: videoElement.duration,
				videoWidth: videoElement.videoWidth,
				videoHeight: videoElement.videoHeight,
				title: this.extractVideoTitle(videoElement),
				sources: this.extractVideoSources(videoElement),
				element: videoElement
			};

			if (videoInfo.src || videoInfo.sources.length > 0) {
				this.videos.set(id, videoInfo);
				console.log('Video detected:', videoInfo);
			}
		} catch (error) {
			console.error('Error analyzing video element:', error);
		}
	}

	extractVideoTitle(videoElement) {
		// Try multiple methods to extract a meaningful title
		const title =
			videoElement.title ||
			videoElement.getAttribute('aria-label') ||
			videoElement.getAttribute('data-title') ||
			document.title ||
			`Video_${Date.now()}`;

		return title.substring(0, 100); // Limit length
	}

	extractVideoSources(videoElement) {
		const sources = [];

		// Get source elements
		const sourceElements = videoElement.querySelectorAll('source');
		sourceElements.forEach(source => {
			if (source.src) {
				sources.push({
					src: source.src,
					type: source.type,
					quality: this.extractQualityFromUrl(source.src) || 'unknown'
				});
			}
		});

		// If no source elements, use the video src
		if (sources.length === 0 && videoElement.src) {
			sources.push({
				src: videoElement.src,
				type: videoElement.type || 'video/mp4',
				quality: this.extractQualityFromUrl(videoElement.src) || 'unknown'
			});
		}

		return sources;
	}

	extractQualityFromUrl(url) {
		// Try to extract quality information from URL
		const qualityMatches = url.match(/(\d{3,4}p?|\d{3,4}x\d{3,4})/i);
		if (qualityMatches) {
			return qualityMatches[1];
		}

		// Check for common quality indicators
		const qualityIndicators = {
			'hd': '720p',
			'fullhd': '1080p',
			'uhd': '4k',
			'4k': '4k',
			'low': '360p',
			'medium': '480p',
			'high': '720p'
		};

		for (const [indicator, quality] of Object.entries(qualityIndicators)) {
			if (url.toLowerCase().includes(indicator)) {
				return quality;
			}
		}

		return null;
	}

	setupDOMObserver() {
		const self = this;
		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node.nodeType === 1) { // Element node
						// Check if the added node is a video
						if (node.tagName === 'VIDEO') {
							const id = `video-${self.videos.size}`;
							self.analyzeVideoElement(node, id);
						}

						// Check for video elements within the added node
						const videos = node.querySelectorAll && node.querySelectorAll('video');
						if (videos) {
							videos.forEach((video, index) => {
								const id = `video-${self.videos.size}-${index}`;
								self.analyzeVideoElement(video, id);
							});
						}
					}
				});
			});
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true
		});

		this.observers.push(observer);
	}

	setupNetworkObserver() {
		// Intercept network requests to detect video streams
		this.interceptVideoRequests();

		// Monitor for HLS and DASH manifests
		this.monitorStreamingRequests();

		// Special handling for popular video sites
		this.setupSiteSpecificDetection();
	}

	interceptVideoRequests() {
		const originalFetch = window.fetch;
		const self = this;

		window.fetch = async function (...args) {
			const [resource, config] = args;
			const url = typeof resource === 'string' ? resource : resource.url;

			// Check if this is a video request
			if (self.isVideoUrl(url)) {
				console.log('Video request intercepted:', url);
				self.handleVideoRequest(url);
			}

			return originalFetch.apply(this, args);
		};

		// Also intercept XMLHttpRequest
		const originalXHROpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function (method, url, ...rest) {
			if (self.isVideoUrl(url)) {
				console.log('XHR video request intercepted:', url);
				self.handleVideoRequest(url);
			}
			return originalXHROpen.call(this, method, url, ...rest);
		};
	}

	monitorStreamingRequests() {
		// Monitor for HLS (.m3u8) and DASH (.mpd) manifest files
		const observer = new PerformanceObserver((list) => {
			list.getEntries().forEach((entry) => {
				if (this.isStreamingManifest(entry.name)) {
					console.log('Streaming manifest detected:', entry.name);
					this.handleStreamingManifest(entry.name);
				}
			});
		});

		observer.observe({ entryTypes: ['resource'] });
		this.observers.push(observer);
	}

	setupSiteSpecificDetection() {
		const hostname = window.location.hostname;

		// Other video sites
		if (hostname.includes('douyin.com') || hostname.includes('tiktok.com')) {
			this.setupShortVideoDetection();
		}

		if (hostname.includes('iqiyi.com') || hostname.includes('youku.com') || hostname.includes('qq.com')) {
			this.setupChineseVideoSiteDetection();
		}
	}

	setupShortVideoDetection() {
		console.log('Setting up short video platform detection');
		const self = this;

		// Monitor for video elements commonly used by short video platforms
		const observer = new MutationObserver((mutations) => {
			mutations.forEach(mutation => {
				mutation.addedNodes.forEach(node => {
					if (node.nodeType === 1) {
						const videos = node.querySelectorAll && node.querySelectorAll('video');
						if (videos) {
							videos.forEach(video => {
								self.analyzeVideoElement(video, `short-video-${Date.now()}`);
							});
						}
					}
				});
			});
		});

		observer.observe(document.body, { childList: true, subtree: true });
		this.observers.push(observer);
	}

	setupChineseVideoSiteDetection() {
		console.log('Setting up Chinese video site detection');
		const self = this;

		// Enhanced detection for Chinese video platforms
		const commonSelectors = [
			'.player-video',
			'.video-player',
			'.iqp-player',
			'.youku-player',
			'.txp-player'
		];

		const checkForVideos = () => {
			commonSelectors.forEach(selector => {
				const containers = document.querySelectorAll(selector);
				containers.forEach(container => {
					const videos = container.querySelectorAll('video');
					videos.forEach(video => {
						self.analyzeVideoElement(video, `chinese-video-${Date.now()}`);
					});
				});
			});
		};

		// Initial check
		checkForVideos();

		// Periodic check for dynamically loaded content
		setInterval(checkForVideos, 3000);
	}

	isVideoUrl(url) {
		const videoExtensions = /\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv|m4v|m4s)(\?.*)?$/i;
		const videoMimeTypes = ['video/', 'application/vnd.apple.mpegurl', 'application/dash+xml'];

		// Add more patterns for streaming formats
		const streamingPatterns = [
			/\.m3u8/i,
			/\.mpd/i,
			/\/dash\//i,
			/\/hls\//i
		];

		return videoExtensions.test(url) ||
			videoMimeTypes.some(type => url.includes(type)) ||
			streamingPatterns.some(pattern => pattern.test(url));
	}

	isStreamingManifest(url) {
		return /\.(m3u8|mpd)(\?.*)?$/i.test(url);
	}

	handleVideoRequest(url) {
		const id = `network-video-${this.videos.size}`;
		const videoInfo = {
			id: id,
			src: url,
			title: this.extractTitleFromPage(),
			quality: this.extractQualityFromUrl(url) || 'unknown',
			type: 'network-detected',
			detectedAt: Date.now()
		};

		this.videos.set(id, videoInfo);
		this.notifyVideoDetected(videoInfo);
	}

	async handleStreamingManifest(manifestUrl) {
		try {
			// Fetch and parse the manifest to extract video qualities
			const response = await fetch(manifestUrl);
			const manifestContent = await response.text();

			let videoStreams = [];

			if (manifestUrl.includes('.m3u8')) {
				videoStreams = this.parseHLSManifest(manifestContent, manifestUrl);
			} else if (manifestUrl.includes('.mpd')) {
				videoStreams = this.parseDASHManifest(manifestContent, manifestUrl);
			}

			videoStreams.forEach((stream, index) => {
				const id = `stream-${this.videos.size}-${index}`;
				const videoInfo = {
					id: id,
					src: stream.url,
					title: this.extractTitleFromPage(),
					quality: stream.quality,
					bandwidth: stream.bandwidth,
					type: 'streaming',
					detectedAt: Date.now()
				};

				this.videos.set(id, videoInfo);
				this.notifyVideoDetected(videoInfo);
			});
		} catch (error) {
			console.error('Error parsing streaming manifest:', error);
		}
	}

	parseHLSManifest(content, baseUrl) {
		const streams = [];
		const lines = content.split('\n');
		let currentQuality = null;
		let currentBandwidth = null;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			// Parse stream info
			if (line.startsWith('#EXT-X-STREAM-INF:')) {
				const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
				const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);

				currentBandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : null;
				currentQuality = resolutionMatch ? this.resolutionToQuality(resolutionMatch[1]) : 'unknown';
			} else if (line && !line.startsWith('#')) {
				// This is a stream URL
				const streamUrl = this.resolveUrl(line, baseUrl);
				streams.push({
					url: streamUrl,
					quality: currentQuality || 'unknown',
					bandwidth: currentBandwidth
				});
				currentQuality = null;
				currentBandwidth = null;
			}
		}

		return streams;
	}

	parseDASHManifest(content, baseUrl) {
		// Simple DASH manifest parsing (would need more robust XML parsing in production)
		const streams = [];

		try {
			const parser = new DOMParser();
			const xmlDoc = parser.parseFromString(content, 'text/xml');
			const representations = xmlDoc.querySelectorAll('Representation');

			representations.forEach(rep => {
				const bandwidth = rep.getAttribute('bandwidth');
				const width = rep.getAttribute('width');
				const height = rep.getAttribute('height');

				// Find the base URL or segment template
				const baseURL = rep.querySelector('BaseURL');
				const segmentTemplate = rep.querySelector('SegmentTemplate');

				if (baseURL) {
					streams.push({
						url: this.resolveUrl(baseURL.textContent, baseUrl),
						quality: width && height ? `${height}p` : 'unknown',
						bandwidth: bandwidth ? parseInt(bandwidth) : null
					});
				}
			});
		} catch (error) {
			console.error('Error parsing DASH manifest:', error);
		}

		return streams;
	}

	resolveUrl(url, baseUrl) {
		if (url.startsWith('http')) {
			return url;
		}

		try {
			return new URL(url, baseUrl).href;
		} catch (error) {
			console.error('Error resolving URL:', error);
			return url;
		}
	}

	resolutionToQuality(resolution) {
		const [width, height] = resolution.split('x').map(Number);

		if (height >= 2160) return '4k';
		if (height >= 1440) return '1440p';
		if (height >= 1080) return '1080p';
		if (height >= 720) return '720p';
		if (height >= 480) return '480p';
		if (height >= 360) return '360p';

		return 'unknown';
	}

	extractTitleFromPage() {
		// Try to extract a meaningful title from the page
		const title =
			document.querySelector('h1')?.textContent ||
			document.querySelector('.title')?.textContent ||
			document.querySelector('[class*="title"]')?.textContent ||
			document.title ||
			window.location.hostname;

		return title.substring(0, 100);
	}

	detectIframeVideos() {
		const iframes = document.querySelectorAll('iframe');
		iframes.forEach((iframe, index) => {
			try {
				// Check if iframe contains video-related content
				if (this.isVideoIframe(iframe)) {
					const id = `iframe-video-${index}`;
					const videoInfo = {
						id: id,
						src: iframe.src,
						title: this.extractTitleFromPage(),
						type: 'iframe-embedded',
						iframe: true
					};

					this.videos.set(id, videoInfo);
				}
			} catch (error) {
				// Cross-origin iframe access might be blocked
				console.log('Cannot access iframe content (cross-origin):', iframe.src);
			}
		});
	}

	isVideoIframe(iframe) {
		const src = iframe.src.toLowerCase();
		const videoIndicators = ['video', 'player', 'embed', 'stream'];

		return videoIndicators.some(indicator => src.includes(indicator)) ||
			iframe.title.toLowerCase().includes('video') ||
			iframe.className.toLowerCase().includes('video');
	}

	setupMessageHandler() {
		chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			switch (request.action) {
				case 'getVideos':
					this.getDetectedVideos(sendResponse);
					return true;

				case 'refreshVideos':
					this.refreshVideoDetection(sendResponse);
					return true;

				case 'contextMenuDownload':
					this.handleContextMenuDownload(request.data, sendResponse);
					return true;

				case 'downloadVideo':
					this.downloadVideo(request.data, sendResponse);
					return true;

				default:
					sendResponse({ error: 'Unknown action' });
			}
		});
	}

	getDetectedVideos(sendResponse) {
		const videoList = Array.from(this.videos.values()).map(video => ({
			id: video.id,
			src: video.src,
			title: video.title,
			quality: video.quality,
			type: video.type,
			sources: video.sources || [],
			poster: video.poster,
			duration: video.duration,
			videoWidth: video.videoWidth,
			videoHeight: video.videoHeight,
			bandwidth: video.bandwidth
		}));

		sendResponse({
			success: true,
			videos: videoList,
			count: videoList.length
		});
	}

	refreshVideoDetection(sendResponse) {
		// Clear existing videos and re-detect
		this.videos.clear();
		this.detectVideoElements();
		window.postMessage({ type: 'SCAN_FOR_VIDEOS' }, '*');

		setTimeout(() => {
			this.getDetectedVideos(sendResponse);
		}, 1000); // Give time for detection to complete
	}

	handleContextMenuDownload(data, sendResponse) {
		const { mediaUrl, pageUrl } = data;

		// Create a video info object for the context menu selection
		const id = `context-menu-${Date.now()}`;
		const videoInfo = {
			id: id,
			src: mediaUrl,
			title: this.extractTitleFromPage(),
			quality: this.extractQualityFromUrl(mediaUrl) || 'unknown',
			type: 'context-menu'
		};

		this.videos.set(id, videoInfo);
		this.notifyVideoDetected(videoInfo);

		sendResponse({ success: true, video: videoInfo });
	}

	// Download video in page context (has full browser environment)
	async downloadVideo(videoData, sendResponse) {
		try {
			const { url, title, quality, size, format } = videoData;

			console.log(`🚀 Starting page-context download: ${title}`);
			console.log(`📝 Download data:`, {
				url: url,
				title: title,
				quality: quality,
				size: size,
				format: format,
				urlType: url.startsWith('blob:') ? 'BLOB' : url.startsWith('data:') ? 'DATA' : 'HTTP'
			});

			// Send initial response
			sendResponse({
				success: true,
				message: 'Starting download in page context...'
			});

			// Notify progress
			this.notifyProgress('Downloading video in page context...', 0);

			// Download video in page context (with full browser environment)
			const response = await this.fetchVideoInPageContext(url);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			// Get video data as blob with progress
			const contentLength = response.headers.get('content-length');
			const total = contentLength ? parseInt(contentLength, 10) : 0;

			let loaded = 0;
			const videoBlob = await this.readResponseWithProgress(response, total, (progress) => {
				this.notifyProgress(`Caching: ${Math.round(progress * 100)}%`, Math.round(progress * 50));
			});

			console.log(`Video downloaded in page context: ${videoBlob.size} bytes`);
			this.notifyProgress('Preparing download file...', 75);

			// Convert blob to array buffer for efficient transfer
			const arrayBuffer = await videoBlob.arrayBuffer();

			// Send blob data to service worker for saving
			chrome.runtime.sendMessage({
				action: 'saveBlobVideo',
				data: {
					arrayBuffer: Array.from(new Uint8Array(arrayBuffer)), // Convert to transferable format
					mimeType: videoBlob.type || 'video/mp4',
					title: title,
					quality: quality,
					format: format,
					size: arrayBuffer.byteLength
				}
			}, (response) => {
				if (chrome.runtime.lastError) {
					console.error('Message sending failed:', chrome.runtime.lastError);
					this.notifyProgress('Failed to send to service worker', 0);
				} else if (response && response.success) {
					console.log('Video saved successfully');
					this.notifyProgress('Download completed!', 100);
				} else {
					console.error('Failed to save video:', response?.error);
					this.notifyProgress(`Save failed: ${response?.error}`, 0);
				}
			});

		} catch (error) {
			console.error('Page-context download failed:', error);
			this.notifyProgress(`Download failed: ${error.message}`, 0);

			// Notify background script of error
			chrome.runtime.sendMessage({
				action: 'downloadError',
				data: {
					error: error.message,
					title: videoData.title
				}
			});
		}
	}

	// Fetch video using page context (inherits all browser state)
	async fetchVideoInPageContext(url) {
		console.log('🎯 Fetching video in page context:', url);

		// Check blob/data URLs first before attempting URL parsing
		if (url.startsWith('blob:')) {
			console.warn('❌ Detected blob URL, cannot download directly:', url);
			throw new Error('Blob URLs cannot be downloaded. Please try refreshing the page and selecting a different video quality.');
		}

		if (url.startsWith('data:')) {
			console.warn('❌ Detected data URL, cannot download directly:', url);
			throw new Error('Data URLs cannot be downloaded. Please try a different video source.');
		}

		// Safe URL analysis (only for logging)
		try {
			const parsed = new URL(url);
			console.log('🔍 URL analysis:', {
				protocol: parsed.protocol,
				hostname: parsed.hostname,
				pathname: parsed.pathname
			});
		} catch (e) {
			console.warn('🔍 URL analysis failed (possibly relative URL):', url);
		}

		// Use page's native fetch (has access to all cookies, sessions, etc.)
		const response = await fetch(url, {
			method: 'GET',
			credentials: 'include', // Include all cookies and auth
			headers: {
				'Accept': 'video/webm,video/mp4,video/*,*/*;q=0.9',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				'User-Agent': navigator.userAgent, // Use real browser UA
				'Sec-Fetch-Dest': 'video',
				'Sec-Fetch-Mode': 'cors',
				'Sec-Fetch-Site': 'same-origin',
				'Referer': window.location.href // Use actual page as referrer
			}
		});

		return response;
	}

	// Read response with progress tracking
	async readResponseWithProgress(response, total, progressCallback) {
		const reader = response.body.getReader();
		const chunks = [];
		let loaded = 0;

		while (true) {
			const { done, value } = await reader.read();

			if (done) break;

			chunks.push(value);
			loaded += value.length;

			if (total > 0 && progressCallback) {
				progressCallback(loaded / total);
			}
		}

		// Combine chunks into single blob
		const combinedArray = new Uint8Array(loaded);
		let offset = 0;

		for (const chunk of chunks) {
			combinedArray.set(chunk, offset);
			offset += chunk.length;
		}

		return new Blob([combinedArray], { type: response.headers.get('content-type') || 'video/mp4' });
	}

	// Notify progress to popup
	notifyProgress(message, percentage) {
		chrome.runtime.sendMessage({
			action: 'downloadProgress',
			data: {
				downloadId: 'content-script-download',
				message: message,
				percentage: percentage,
				phase: percentage === 100 ? 'completed' : 'downloading'
			}
		}).catch(() => {
			// Ignore errors when popup is closed
		});
	}

	notifyVideoDetected(videoInfo) {
		// Notify background script about new video
		chrome.runtime.sendMessage({
			action: 'videoDetected',
			data: videoInfo
		}).catch(() => {
			// Background script might not be ready, ignore error
		});
	}

	startDetection() {
		// Initial detection
		setTimeout(() => {
			this.detectVideoElements();
		}, 1000);

		// Periodic re-detection for dynamic content
		setInterval(() => {
			this.detectVideoElements();
		}, 5000);
	}

	cleanup() {
		// Clean up observers when the page is unloaded
		this.observers.forEach(observer => {
			if (observer.disconnect) {
				observer.disconnect();
			}
		});
	}
}

// Initialize video detector when page is loaded
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		window.videoDetector = new VideoDetector();
	});
} else {
	window.videoDetector = new VideoDetector();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
	if (window.videoDetector) {
		window.videoDetector.cleanup();
	}
});
