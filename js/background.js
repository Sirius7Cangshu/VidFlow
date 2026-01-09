// Video Download Helper - Background Service Worker
// Handles downloads, storage, and cross-tab communication

// Global state
const downloadQueue = new Map();
const activeDownloads = new Map();
const capturedVideosByTab = new Map();
const __agentDbg = { segSkipOnce: new Set(), capCountByTab: new Map() };

let extensionInitialized = false;
let webRequestMonitorInitialized = false;
let capturePrefs = {
	minSizeBytes: 300 * 1024
};

// Service Worker lifecycle events
self.addEventListener('install', (event) => {
	console.log('Video Download Helper Service Worker installing...');
	self.skipWaiting(); // Force the waiting service worker to become the active service worker
});

self.addEventListener('activate', (event) => {
	console.log('Video Download Helper Service Worker activated');
	event.waitUntil(self.clients.claim()); // Claim control of all clients

	// Initialize the extension
	initializeExtension();
});

// Initialize service worker
console.log('Video Download Helper background service worker starting...');

function initializeExtension() {
	if (extensionInitialized) {
		return;
	}
	extensionInitialized = true;

	try {
		loadCapturePrefs();
		setupDownloadListeners();
		setupMessageHandlers();
		setupWebRequestMonitor();
		setupTabLifecycleHandlers();

		// Setup context menu with delay to ensure chrome APIs are ready
		setTimeout(() => {
			setupContextMenu();
		}, 100);

		console.log('Video Download Helper background service initialized');
	} catch (error) {
		console.error('Failed to initialize background service:', error);
	}
}

// Initialize immediately for already active service worker
if (self.registration && self.registration.active) {
	initializeExtension();
}

function setupDownloadListeners() {
	chrome.downloads.onChanged.addListener((downloadDelta) => {
		if (downloadDelta.state && downloadDelta.state.current === 'complete') {
			handleDownloadComplete(downloadDelta.id);
			return;
		}

		if (downloadDelta.state && downloadDelta.state.current === 'interrupted') {
			const reason = downloadDelta.error && downloadDelta.error.current ?
				downloadDelta.error.current :
				'interrupted';
			handleDownloadError(downloadDelta.id, reason);
			return;
		}

		if (downloadDelta.bytesReceived || downloadDelta.totalBytes) {
			updateDownloadProgress(downloadDelta.id, downloadDelta);
		}
	});
}

function setupMessageHandlers() {
	chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
		switch (request.action) {
			case 'ensureInjected':
				ensureInjected(sender, sendResponse);
				return true;

			case 'startDownload':
				startDownload(request.data, sendResponse);
				return true; // Keep message channel open for async response

			case 'saveBlobVideo':
				saveBlobVideo(request.data, sendResponse);
				return true;

			case 'downloadError':
				handleDownloadError('content-script-download', request.data.error);
				sendResponse({ success: true });
				return true;

			case 'downloadProgress':
				// Forward progress to popup
				notifyPopup('downloadProgress', request.data);
				sendResponse({ success: true });
				return true;

			case 'getDownloadProgress':
				getDownloadProgress(request.downloadId, sendResponse);
				return true;

			case 'cancelDownload':
				cancelDownload(request.downloadId, sendResponse);
				return true;

			case 'getDownloadStats':
				getDownloadStats(sendResponse);
				return true;

			case 'clearCache':
				clearVideoCache(sendResponse);
				return true;

			case 'getCapturedVideos':
				getCapturedVideos(request.tabId, sender, sendResponse);
				return true;

			case 'clearCapturedVideos':
				clearCapturedVideos(request.tabId, sender, sendResponse);
				return true;

			case 'getCapturePrefs':
				sendResponse({ success: true, prefs: capturePrefs });
				return true;

			case 'updateCapturePrefs':
				updateCapturePrefs(request.prefs, sendResponse);
				return true;

			case 'videoDetected':
				// Content script notifies about detected videos; we can ignore since
				// webRequest listener already captures network-level video requests.
				sendResponse({ success: true });
				return true;

			default:
				sendResponse({ error: 'Unknown action' });
		}
	});
}

async function loadCapturePrefs() {
	try {
		const result = await chrome.storage.local.get(['capturePrefs']);
		if (result && result.capturePrefs && typeof result.capturePrefs.minSizeBytes === 'number') {
			capturePrefs.minSizeBytes = result.capturePrefs.minSizeBytes;
		}
	} catch (error) {
		// Ignore
	}
}

async function updateCapturePrefs(prefs, sendResponse) {
	try {
		if (prefs && typeof prefs.minSizeBytes === 'number') {
			capturePrefs.minSizeBytes = prefs.minSizeBytes;
			await chrome.storage.local.set({ capturePrefs: { minSizeBytes: capturePrefs.minSizeBytes } });
		}
		sendResponse({ success: true, prefs: capturePrefs });
	} catch (error) {
		sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
	}
}

function setupTabLifecycleHandlers() {
	if (!chrome.tabs) {
		return;
	}

	chrome.tabs.onRemoved.addListener((tabId) => {
		capturedVideosByTab.delete(tabId);
	});

	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		if (changeInfo.status === 'loading') {
			capturedVideosByTab.delete(tabId);
		}
	});
}

function setupWebRequestMonitor() {
	if (webRequestMonitorInitialized) {
		return;
	}
	webRequestMonitorInitialized = true;

	if (!chrome.webRequest || !chrome.webRequest.onHeadersReceived) {
		console.warn('Chrome webRequest API not available');
		return;
	}

	chrome.webRequest.onHeadersReceived.addListener(
		(details) => {
			if (details.tabId == null || details.tabId < 0) {
				return;
			}

			const url = details.url;
			if (isYouTubeUrl(url)) {
				return;
			}

			if (!isVideoResponse(url, details.type, details.responseHeaders)) {
				return;
			}

			recordCapturedVideo(details.tabId, url, details);
		},
		{ urls: ['http://*/*', 'https://*/*'] },
		['responseHeaders', 'extraHeaders']
	);
}

function isVideoResponse(url, requestType, responseHeaders) {
	if (!url) {
		return false;
	}

	const urlLower = url.toLowerCase();

	if (/\.(m3u8|mpd)(\?.*)?$/.test(urlLower)) {
		return true;
	}

	// Ignore HLS segment noise (we download segments via playlist in manager)
	// Match patterns like: .ts, .ts?xxx, /0.ts, /seg_123.ts
	if (/[\/\-_\.](\d+\.ts|seg[_\-]?\d*\.ts)(\?.*)?$/i.test(urlLower) || /\.ts(\?.*)?$/.test(urlLower)) {
		return false;
	}

	if (/\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv|m4v|m4s)(\?.*)?$/.test(urlLower)) {
		return true;
	}

	if (requestType === 'media') {
		return true;
	}

	const headers = Array.isArray(responseHeaders) ? responseHeaders : [];
	for (const h of headers) {
		if (!h || !h.name || !h.value) {
			continue;
		}
		if (h.name.toLowerCase() !== 'content-type') {
			continue;
		}
		const ct = h.value.toLowerCase();
		if (ct.startsWith('video/')) {
			return true;
		}
		if (ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl')) {
			return true;
		}
		if (ct.includes('application/dash+xml')) {
			return true;
		}
	}

	return false;
}

function recordCapturedVideo(tabId, url, details) {
	let tabMap = capturedVideosByTab.get(tabId);
	if (!tabMap) {
		tabMap = new Map();
		capturedVideosByTab.set(tabId, tabMap);
	}

	if (tabMap.has(url)) {
		return;
	}

	const urlLower = String(url || '').toLowerCase();
	if (isBlockedSourceUrl(url)) {
		return;
	}

	// Do not capture stream segments as "videos" (manager will download segments via playlists).
	// Sites may use suffix-based or query-based segment URLs, so we also filter by content-type below.
	if (/\.(ts|m4s)(\?.*)?$/.test(urlLower) || urlLower.includes('.ts?')) {
		return;
	}

	if (/\.(vtt|srt|vtt)(\?.*)?$/.test(urlLower)) {
		return;
	}
	if (/\.(jpg|jpeg|png|gif|webp|css|js|html|json)(\?.*)?$/.test(urlLower)) {
		return;
	}

	const headers = Array.isArray(details && details.responseHeaders) ? details.responseHeaders : [];
	const contentType = getHeaderValue(headers, 'content-type');
	const contentLengthStr = getHeaderValue(headers, 'content-length');
	const sizeBytes = contentLengthStr ? Number(contentLengthStr) : 0;

	const ct0 = String(contentType || '').toLowerCase().split(';')[0].trim();

	// Always keep playlists (m3u8/mpd). They are small but essential for quality variants.
	const isPlaylist =
		/\.(m3u8|mpd)(\?.*)?$/.test(urlLower) ||
		ct0.includes('application/vnd.apple.mpegurl') ||
		ct0.includes('application/x-mpegurl') ||
		ct0.includes('application/dash+xml');

	// Filter out segment-like responses even if URL has no .ts/.m4s suffix.
	const isSegmentCt =
		ct0.includes('video/mp2t') ||
		ct0.includes('video/mpegts') ||
		ct0.includes('video/iso.segment');
	if (isSegmentCt) {
		return;
	}

	// Only capture playlists and real direct video files.
	const isVideoCt = ct0.startsWith('video/');
	const isDirectVideoByExt = /\.(mp4|webm|mkv|mov|flv|avi)(\?.*)?$/.test(urlLower);
	if (!isPlaylist && !(isVideoCt || isDirectVideoByExt)) {
		return;
	}

	if (!isPlaylist && sizeBytes > 0 && sizeBytes < capturePrefs.minSizeBytes) {
		return;
	}

	const videoInfo = {
		id: `wr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
		src: url,
		title: (details && details.initiator) ? details.initiator : 'Captured Video',
		quality: extractQualityFromUrl(url) || 'unknown',
		type: 'network-detected',
		detectedAt: Date.now(),
		sizeBytes: isPlaylist ? 0 : sizeBytes,
		contentType
	};

	tabMap.set(url, videoInfo);

	if (tabMap.size > 200) {
		const firstKey = tabMap.keys().next().value;
		tabMap.delete(firstKey);
	}
}

function isBlockedSourceUrl(url) {
	try {
		const host = new URL(url).hostname.toLowerCase();
		if (!host) return false;
		if (host === 'cctv.com' || host.endsWith('.cctv.com')) return true;
		if (host === 'cctv.cn' || host.endsWith('.cctv.cn')) return true;
		if (host === 'cntv.cn' || host.endsWith('.cntv.cn')) return true;
		return false;
	} catch (_) {
		return false;
	}
}

function extractQualityFromUrl(url) {
	const u = String(url || '');

	// Pattern 1: /1920x1080/ format
	const mRes = u.match(/\/(\d{3,4})x(\d{3,4})\//i);
	if (mRes) {
		const h = Number(mRes[2]);
		if (Number.isFinite(h) && h > 0) {
			return `${h}p`;
		}
	}

	// Pattern 2: /1080p/ or _1080p. format
	const mP = u.match(/[/_](\d{3,4})p[/_.\-\?]/i);
	if (mP) {
		return `${mP[1]}p`;
	}

	// Pattern 3: Filename like /450.m3u8 or /1200.m3u8 (bitrate indicator)
	const fileMatch = u.match(/\/(\d{3,4})\.m3u8/i);
	if (fileMatch) {
		const num = Number(fileMatch[1]);
		if (num >= 2000) return '1080p';
		if (num >= 1000) return '720p';
		if (num >= 600) return '480p';
		if (num >= 350) return '360p';
		if (num >= 200) return '240p';
		if (num === 1080 || num === 720 || num === 480 || num === 360 || num === 240) {
			return `${num}p`;
		}
		return `${num}k`;
	}

	return null;
}

function getHeaderValue(headers, name) {
	const key = String(name || '').toLowerCase();
	for (const h of headers) {
		if (!h || !h.name) {
			continue;
		}
		if (String(h.name).toLowerCase() !== key) {
			continue;
		}
		return h.value || '';
	}
	return '';
}

function getCapturedVideos(tabId, sender, sendResponse) {
	const resolvedTabId = (tabId != null) ? tabId : (sender && sender.tab ? sender.tab.id : null);
	if (resolvedTabId == null) {
		sendResponse({ success: false, error: 'No tab context' });
		return;
	}

	const tabMap = capturedVideosByTab.get(resolvedTabId);
	const videos = tabMap ? Array.from(tabMap.values()) : [];
	const lastCount = __agentDbg.capCountByTab.get(resolvedTabId);
	if (lastCount !== videos.length) {
		__agentDbg.capCountByTab.set(resolvedTabId, videos.length);
		// #region agent log
		fetch('http://127.0.0.1:7243/ingest/78df3085-8a1a-44d1-875a-154e367662c9', { method: 'POST', mode: 'no-cors', body: JSON.stringify({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H2', location: 'background.js:getCapturedVideos', message: 'getCapturedVideos count changed', data: { resolvedTabId, tabMapSize: tabMap ? tabMap.size : 0, returnCount: videos.length, sample: videos.slice(0, 3).map(v => ({ type: v.type, quality: v.quality, srcTail: String(v.src || '').toLowerCase().split('/').pop().split('?')[0], sizeBytes: v.sizeBytes || 0, contentType: String(v.contentType || '').split(';')[0] })) }, timestamp: Date.now() }) }).catch(() => { });
		// #endregion
	}
	sendResponse({ success: true, videos, count: videos.length });
}

function clearCapturedVideos(tabId, sender, sendResponse) {
	const resolvedTabId = (tabId != null) ? tabId : (sender && sender.tab ? sender.tab.id : null);
	if (resolvedTabId == null) {
		sendResponse({ success: false, error: 'No tab context' });
		return;
	}
	const had = capturedVideosByTab.has(resolvedTabId);
	const beforeSize = had && capturedVideosByTab.get(resolvedTabId) ? capturedVideosByTab.get(resolvedTabId).size : 0;
	capturedVideosByTab.delete(resolvedTabId);
	__agentDbg.capCountByTab.delete(resolvedTabId);
	// #region agent log
	fetch('http://127.0.0.1:7243/ingest/78df3085-8a1a-44d1-875a-154e367662c9', { method: 'POST', mode: 'no-cors', body: JSON.stringify({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H1', location: 'background.js:clearCapturedVideos', message: 'clearCapturedVideos executed', data: { resolvedTabId, had, beforeSize, afterHad: capturedVideosByTab.has(resolvedTabId), tabsCount: capturedVideosByTab.size }, timestamp: Date.now() }) }).catch(() => { });
	// #endregion
	sendResponse({ success: true });
}

function setupContextMenu() {
	try {
		// Check if contextMenus API is available
		if (!chrome.contextMenus) {
			console.warn('Chrome contextMenus API not available');
			return;
		}

		chrome.contextMenus.create({
			id: 'downloadVideo',
			title: 'Download Video',
			contexts: ['video', 'link'],
			documentUrlPatterns: [
				'http://*/*',
				'https://*/*'
			]
		}, () => {
			if (chrome.runtime.lastError) {
				console.warn('Context menu creation failed:', chrome.runtime.lastError.message);
			} else {
				console.log('Context menu created successfully');
			}
		});

		chrome.contextMenus.onClicked.addListener((info, tab) => {
			if (info.menuItemId === 'downloadVideo') {
				handleContextMenuDownload(info, tab);
			}
		});
	} catch (error) {
		console.error('Error setting up context menu:', error);
	}
}

async function startDownload(videoData, sendResponse) {
	try {
		const { url, title, quality, size, format } = videoData;

		if (isYouTubeUrl(url)) {
			sendResponse({ error: 'YouTube downloads are not allowed' });
			return;
		}

		const filename = generateFilename(title, quality, format);

		chrome.downloads.download({
			url: url,
			filename: filename,
			saveAs: false,
			conflictAction: 'uniquify'
		}, (chromeDownloadId) => {
			if (chrome.runtime.lastError) {
				console.error('Chrome download failed:', chrome.runtime.lastError);
				sendResponse({
					success: false,
					error: chrome.runtime.lastError.message
				});
				return;
			}

			activeDownloads.set(chromeDownloadId, {
				url,
				title,
				quality,
				size: size || null,
				format,
				startTime: Date.now(),
				phase: 'downloading'
			});

			notifyPopup('downloadProgress', {
				downloadId: chromeDownloadId,
				phase: 'downloading',
				percentage: 0,
				bytesReceived: 0,
				totalBytes: size || null,
				message: 'Download started...'
			});

			sendResponse({
				success: true,
				downloadId: chromeDownloadId
			});
		});

	} catch (error) {
		console.error('Download initialization failed:', error);
		sendResponse({
			error: error.message || 'Download initialization failed',
			details: error.toString()
		});
	}
}

async function ensureInjected(sender, sendResponse) {
	try {
		if (!sender.tab || sender.tab.id == null) {
			sendResponse({ success: false, error: 'No tab context' });
			return;
		}

		await chrome.scripting.executeScript({
			target: { tabId: sender.tab.id },
			files: ['js/injected.js'],
			world: 'MAIN'
		});

		sendResponse({ success: true });
	} catch (error) {
		console.warn('Failed to inject main-world script:', error);
		sendResponse({
			success: false,
			error: error && error.message ? error.message : String(error)
		});
	}
}

async function cacheAndDownloadVideo(downloadId, url, title, quality, format) {
	try {
		console.log(`Caching video: ${title} (${quality})`);

		// Update progress - start caching
		notifyPopup('downloadProgress', {
			downloadId,
			phase: 'caching',
			percentage: 0,
			message: 'Caching video data...'
		});

		let response;
		let videoBlob;

		try {
			// Attempt primary fetch with full headers
			response = await fetchWithProgress(url, (progress) => {
				notifyPopup('downloadProgress', {
					downloadId,
					phase: 'caching',
					percentage: Math.round(progress * 50), // First 50% for caching
					message: `Caching: ${Math.round(progress * 100)}%`
				});
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			// Get the video data as blob
			videoBlob = await response.blob();
			console.log(`Video cached via primary method: ${videoBlob.size} bytes`);

		} catch (primaryError) {
			console.warn('Primary fetch failed, trying fallback method:', primaryError.message);

			// Fallback: Try simple fetch without custom headers
			notifyPopup('downloadProgress', {
				downloadId,
				phase: 'caching',
				percentage: 10,
				message: 'Trying alternative download method...'
			});

			try {
				const fallbackResponse = await fetch(url, {
					method: 'GET',
					mode: 'no-cors'
				});

				if (!fallbackResponse.ok && fallbackResponse.status !== 0) {
					throw new Error(`Fallback fetch failed: ${fallbackResponse.status}`);
				}

				videoBlob = await fallbackResponse.blob();
				console.log(`Video cached via fallback method: ${videoBlob.size} bytes`);

			} catch (fallbackError) {
				console.error('Both primary and fallback methods failed');
				throw new Error(`Download failed: ${primaryError.message}. Fallback also failed: ${fallbackError.message}. Please check if the video is accessible and try again.`);
			}
		}

		// Update progress - start download
		notifyPopup('downloadProgress', {
			downloadId,
			phase: 'downloading',
			percentage: 75,
			message: 'Preparing download...'
		});

		// Create blob URL
		const blobUrl = URL.createObjectURL(videoBlob);

		// Generate filename
		const filename = generateFilename(title, quality, format);

		// Download the cached data
		chrome.downloads.download({
			url: blobUrl,
			filename: filename,
			saveAs: false,
			conflictAction: 'uniquify'
		}, (chromeDownloadId) => {
			if (chrome.runtime.lastError) {
				console.error('Chrome download failed:', chrome.runtime.lastError);
				handleDownloadError(downloadId, chrome.runtime.lastError.message);
			} else {
				console.log('Chrome download started:', chromeDownloadId);

				// Update download info with Chrome download ID
				const downloadInfo = activeDownloads.get(downloadId);
				if (downloadInfo) {
					downloadInfo.chromeDownloadId = chromeDownloadId;
					downloadInfo.phase = 'saving';
					downloadInfo.blobUrl = blobUrl;
				}

				// Notify completion
				notifyPopup('downloadProgress', {
					downloadId,
					phase: 'saving',
					percentage: 100,
					message: 'Saving to downloads folder...'
				});

				// Clean up blob URL after a delay
				setTimeout(() => {
					URL.revokeObjectURL(blobUrl);
				}, 60000); // Clean up after 1 minute
			}
		});

		// Update statistics
		await updateDownloadStats();

	} catch (error) {
		console.error('Cache and download failed:', error);
		handleDownloadError(downloadId, error.message);
	}
}

// Save video blob received from content script  
async function saveBlobVideo(blobData, sendResponse) {
	try {
		const { arrayBuffer, mimeType, title, quality, format, size } = blobData;

		console.log(`Saving video blob: ${title} (${size} bytes)`);

		// Convert array back to Uint8Array
		const uint8Array = new Uint8Array(arrayBuffer);

		// Create blob from array buffer
		const videoBlob = new Blob([uint8Array], { type: mimeType });

		// Create blob URL
		const blobUrl = URL.createObjectURL(videoBlob);

		// Generate filename
		const filename = generateFilename(title, quality, format);

		// Download using Chrome API
		chrome.downloads.download({
			url: blobUrl,
			filename: filename,
			saveAs: false,
			conflictAction: 'uniquify'
		}, (chromeDownloadId) => {
			if (chrome.runtime.lastError) {
				console.error('Chrome download failed:', chrome.runtime.lastError);
				sendResponse({
					success: false,
					error: chrome.runtime.lastError.message
				});
			} else {
				activeDownloads.set(chromeDownloadId, {
					url: blobUrl,
					title,
					quality,
					size: size || null,
					format,
					startTime: Date.now(),
					phase: 'saving',
					blobUrl
				});

				console.log('Video saved successfully:', chromeDownloadId);
				sendResponse({
					success: true,
					downloadId: chromeDownloadId
				});

				// Clean up blob URL after delay
				setTimeout(() => {
					URL.revokeObjectURL(blobUrl);
				}, 60000);
			}
		});

	} catch (error) {
		console.error('Failed to save video blob:', error);
		sendResponse({
			success: false,
			error: error.message
		});
	}
}

async function fetchWithProgress(url, progressCallback) {
	// Build headers to bypass common CORS protections
	const headers = {
		'Accept': 'video/webm,video/mp4,video/*,*/*;q=0.9',
		'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
		'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		'Sec-Fetch-Dest': 'video',
		'Sec-Fetch-Mode': 'no-cors',
		'Sec-Fetch-Site': 'same-origin'
	};

	// Add specific headers for different video sites
	if (url.includes('douyin.com')) {
		headers['Referer'] = 'https://www.douyin.com/';
		headers['Origin'] = 'https://www.douyin.com';
	} else {
		// Generic headers for other sites
		const urlObj = new URL(url);
		headers['Referer'] = `${urlObj.protocol}//${urlObj.host}/`;
		headers['Origin'] = `${urlObj.protocol}//${urlObj.host}`;
	}

	const response = await fetch(url, {
		method: 'GET',
		headers: headers,
		mode: 'cors',
		credentials: 'omit'
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const contentLength = response.headers.get('content-length');
	if (!contentLength) {
		console.warn('No content-length header, progress tracking unavailable');
		return response;
	}

	const total = parseInt(contentLength, 10);
	let loaded = 0;

	const reader = response.body.getReader();
	const stream = new ReadableStream({
		start(controller) {
			function pump() {
				return reader.read().then(({ done, value }) => {
					if (done) {
						controller.close();
						return;
					}

					loaded += value.byteLength;
					const progress = loaded / total;

					// Report progress
					if (progressCallback) {
						progressCallback(progress);
					}

					controller.enqueue(value);
					return pump();
				});
			}
			return pump();
		}
	});

	return new Response(stream, {
		headers: response.headers
	});
}

async function downloadWithTimeout(url, filename, timeout = 20000) {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Download timeout after ${timeout}ms`));
		}, timeout);

		chrome.downloads.download({
			url: url,
			filename: filename,
			saveAs: false, // Save to default downloads folder
			conflictAction: 'uniquify'
		}, (downloadId) => {
			clearTimeout(timeoutId);

			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve(downloadId);
			}
		});
	});
}

function generateFilename(title, quality, format) {
	// Sanitize title for filename
	const sanitizedTitle = title
		.replace(/[<>:"/\\|?*]/g, '_')
		.replace(/\s+/g, '_')
		.substring(0, 100); // Limit length

	const qualityTag = quality ? `_${quality}` : '';
	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

	return `videos/${sanitizedTitle}${qualityTag}_${timestamp}.${format}`;
}

function handleDownloadComplete(downloadId) {
	const downloadInfo = activeDownloads.get(downloadId);
	if (downloadInfo) {
		console.log('Download completed:', downloadInfo.title);
		activeDownloads.delete(downloadId);

		// Notify popup if open
		notifyPopup('downloadComplete', { downloadId, downloadInfo });
		updateDownloadStats();
	}
}

function handleDownloadError(downloadId, error) {
	const downloadInfo = activeDownloads.get(downloadId);
	if (downloadInfo) {
		console.error('Download failed:', downloadInfo.title, error);
		activeDownloads.delete(downloadId);

		// Notify popup if open
		notifyPopup('downloadError', {
			downloadId,
			error,
			downloadInfo,
			hint: buildDownloadErrorHint(error, downloadInfo)
		});
	}
}

function buildDownloadErrorHint(error, downloadInfo) {
	const err = typeof error === 'string' ? error : String(error);
	const url = downloadInfo && downloadInfo.url ? downloadInfo.url : '';

	if (err === 'SERVER_FORBIDDEN') {
		return 'The server rejected the request (403). Try refreshing the page and retrying.';
	}

	if (err === 'SERVER_UNAUTHORIZED') {
		return 'The server requires authentication. Try logging in on the site and retrying.';
	}

	if (err === 'SERVER_BAD_CONTENT') {
		return 'The server returned an invalid response. Try another quality or refresh the page.';
	}

	return '';
}

async function updateDownloadProgress(downloadId, downloadDelta) {
	const downloadInfo = activeDownloads.get(downloadId);
	if (!downloadInfo) {
		return;
	}

	const bytesReceived = downloadDelta.bytesReceived && downloadDelta.bytesReceived.current != null ?
		downloadDelta.bytesReceived.current :
		null;

	const totalBytes = downloadDelta.totalBytes && downloadDelta.totalBytes.current != null ?
		downloadDelta.totalBytes.current :
		(downloadInfo.size || null);

	if (totalBytes != null) {
		downloadInfo.size = totalBytes;
	}

	let percentage = 0;
	if (bytesReceived != null && totalBytes != null && totalBytes > 0) {
		percentage = Math.round((bytesReceived / totalBytes) * 100);
	}

	notifyPopup('downloadProgress', {
		downloadId,
		phase: downloadInfo.phase || 'downloading',
		percentage,
		bytesReceived,
		totalBytes
	});
}

function notifyPopup(action, data) {
	// Send message to popup if it's open
	chrome.runtime.sendMessage({
		action: action,
		data: data
	}).catch(() => {
		// Popup is closed, ignore error
	});
}

function isYouTubeUrl(url) {
	const youtubeRegex = /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i;
	return youtubeRegex.test(url);
}

function handleContextMenuDownload(info, tab) {
	// Send message to content script to handle context menu download
	chrome.tabs.sendMessage(tab.id, {
		action: 'contextMenuDownload',
		data: {
			mediaUrl: info.srcUrl || info.linkUrl,
			pageUrl: info.pageUrl
		}
	});
}

async function getDownloadProgress(downloadId, sendResponse) {
	try {
		const downloadInfo = activeDownloads.get(downloadId);
		if (!downloadInfo) {
			sendResponse({ error: 'Download not found' });
			return;
		}

		// Get current download status
		chrome.downloads.search({ id: downloadId }, (results) => {
			if (results.length > 0) {
				const download = results[0];
				sendResponse({
					success: true,
					progress: {
						bytesReceived: download.bytesReceived,
						totalBytes: download.totalBytes,
						percentage: download.totalBytes ?
							Math.round((download.bytesReceived / download.totalBytes) * 100) : 0,
						state: download.state
					}
				});
			} else {
				sendResponse({ error: 'Download status not found' });
			}
		});
	} catch (error) {
		sendResponse({ error: error.message });
	}
}

async function cancelDownload(downloadId, sendResponse) {
	try {
		chrome.downloads.cancel(downloadId, () => {
			if (chrome.runtime.lastError) {
				sendResponse({ error: chrome.runtime.lastError.message });
			} else {
				activeDownloads.delete(downloadId);
				sendResponse({ success: true });
			}
		});
	} catch (error) {
		sendResponse({ error: error.message });
	}
}

async function getDownloadStats(sendResponse) {
	try {
		const result = await chrome.storage.local.get(['downloadStats']);
		const stats = result.downloadStats || {
			totalDownloads: 0,
			downloadsToday: 0,
			lastDownloadDate: null
		};

		// Reset daily count if it's a new day
		const today = new Date().toDateString();
		if (stats.lastDownloadDate !== today) {
			stats.downloadsToday = 0;
			stats.lastDownloadDate = today;
			await chrome.storage.local.set({ downloadStats: stats });
		}

		sendResponse({ success: true, stats });
	} catch (error) {
		sendResponse({ error: error.message });
	}
}

async function updateDownloadStats() {
	try {
		const result = await chrome.storage.local.get(['downloadStats']);
		const stats = result.downloadStats || {
			totalDownloads: 0,
			downloadsToday: 0,
			lastDownloadDate: null
		};

		const today = new Date().toDateString();

		// Reset daily count if it's a new day
		if (stats.lastDownloadDate !== today) {
			stats.downloadsToday = 0;
		}

		stats.totalDownloads++;
		stats.downloadsToday++;
		stats.lastDownloadDate = today;

		await chrome.storage.local.set({ downloadStats: stats });
	} catch (error) {
		console.error('Failed to update download stats:', error);
	}
}

async function clearVideoCache(sendResponse) {
	try {
		// Preserve user preferences before clearing
		const prefsToKeep = await chrome.storage.local.get(['capturePrefs', 'managerPrefs', 'downloadStats']);

		// Clear all cached video data
		await chrome.storage.local.clear();

		// Restore user preferences
		if (prefsToKeep && Object.keys(prefsToKeep).length > 0) {
			await chrome.storage.local.set(prefsToKeep);
		}

		sendResponse({ success: true });
	} catch (error) {
		sendResponse({ error: error.message });
	}
}