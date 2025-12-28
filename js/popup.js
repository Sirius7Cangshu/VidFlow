// Video Download Helper - Popup Script
// Handles popup UI interactions and video download management

class PopupManager {
	constructor() {
		this.videos = [];
		this.currentDownloads = new Map();
		this.isYouTubeSite = false;
		this.isRestrictedPage = false;
		this.currentTabUrl = '';
		this.currentTabHostname = '';
		this.currentTabId = null;
		this.onlyDownloadable = true;
		this.managerPrefs = { minSizeKB: 300, concurrency: 2 };
		this.settingsVisible = false;
		this.init();
	}

	async init() {
		await this.checkCurrentSite();
		await this.loadPreferences();
		await this.loadManagerPrefs();
		this.setupEventListeners();
		this.setupMessageHandler();
		await this.loadDownloadStats();
		await this.refreshVideos();

		console.log('Video Download Helper popup initialized');
	}

	async checkCurrentSite() {
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			const tabUrl = tab && tab.url ? tab.url : '';
			this.isYouTubeSite = /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(tabUrl);
			this.isRestrictedPage = !this.isScriptableUrl(tabUrl);
			this.currentTabUrl = tabUrl;
			this.currentTabHostname = this.safeHostname(tabUrl);

			if (this.isRestrictedPage) {
				this.updateStatus('warning', '该页面受浏览器限制，无法扫描');
				this.showNoVideosMessage();
				return;
			}

			if (this.isYouTubeSite) {
				this.showYouTubeWarning();
			}
		} catch (error) {
			console.error('Error checking current site:', error);
		}
	}

	setupEventListeners() {
		// Header buttons
		document.getElementById('refreshBtn').addEventListener('click', () => {
			this.refreshVideos();
		});

		document.getElementById('settingsBtn').addEventListener('click', () => {
			this.openSettings();
		});

		// Setup dynamic event delegation for video items
		document.getElementById('videoList').addEventListener('click', (e) => {
			const btn = e.target instanceof Element ? e.target.closest('.download-btn') : null;
			if (!btn) {
				return;
			}
			if (btn.dataset.disabled === '1') {
				this.showError(btn.dataset.disabledReason || 'This item cannot be downloaded directly');
				return;
			}
			const videoId = btn.dataset.videoId;
			const quality = btn.dataset.quality;
			this.downloadVideo(videoId, quality);
		});

		const toggle = document.getElementById('onlyDownloadableToggle');
		if (toggle) {
			toggle.addEventListener('change', () => {
				this.onlyDownloadable = Boolean(toggle.checked);
				this.savePreferences();
				this.renderVideoList();
			});
		}
	}

	async loadManagerPrefs() {
		try {
			const result = await chrome.storage.local.get(['managerPrefs']);
			const prefs = result && result.managerPrefs ? result.managerPrefs : null;
			if (prefs && typeof prefs.minSizeKB === 'number') {
				this.managerPrefs.minSizeKB = prefs.minSizeKB;
			}
			if (prefs && typeof prefs.concurrency === 'number') {
				this.managerPrefs.concurrency = prefs.concurrency;
			}
		} catch (error) {
			// Ignore
		}

		const minSizeInput = document.getElementById('minSizeKB');
		if (minSizeInput) {
			minSizeInput.value = String(this.managerPrefs.minSizeKB);
			minSizeInput.addEventListener('change', async () => {
				const v = Number(minSizeInput.value);
				if (!Number.isFinite(v) || v < 0) {
					return;
				}
				this.managerPrefs.minSizeKB = Math.floor(v);
				await this.persistManagerPrefs();
				await this.sendBackgroundMessage({
					action: 'updateCapturePrefs',
					prefs: { minSizeBytes: this.managerPrefs.minSizeKB * 1024 }
				});
			});
		}

		for (const el of document.querySelectorAll('input[name="concurrency"]')) {
			el.checked = Number(el.value) === this.managerPrefs.concurrency;
			el.addEventListener('change', async () => {
				const v = Number(el.value);
				if (!Number.isFinite(v)) {
					return;
				}
				this.managerPrefs.concurrency = v;
				await this.persistManagerPrefs();
			});
		}

		await this.sendBackgroundMessage({
			action: 'updateCapturePrefs',
			prefs: { minSizeBytes: this.managerPrefs.minSizeKB * 1024 }
		});
	}

	async persistManagerPrefs() {
		try {
			await chrome.storage.local.set({ managerPrefs: this.managerPrefs });
		} catch (error) {
			// Ignore
		}
	}

	setupMessageHandler() {
		chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			switch (request.action) {
				case 'downloadProgress':
					this.updateDownloadProgress(request.data);
					break;
				case 'downloadComplete':
					this.handleDownloadComplete(request.data);
					break;
				case 'downloadError':
					this.handleDownloadError(request.data);
					break;
				case 'videoDetected':
					this.handleVideoDetected(request.data);
					break;
			}
		});
	}

	showYouTubeWarning() {
		document.getElementById('youtubeWarning').classList.remove('hidden');
		this.updateStatus('warning', 'YouTube 禁止下载');
	}

	async refreshVideos() {
		this.updateStatus('loading', '正在扫描…');

		try {
			// Get current active tab
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			const tabUrl = tab && tab.url ? tab.url : '';
			this.currentTabUrl = tabUrl;
			this.currentTabHostname = this.safeHostname(tabUrl);
			this.currentTabId = tab && tab.id != null ? tab.id : null;

			if (!this.isScriptableUrl(tabUrl)) {
				this.updateStatus('warning', '该页面受浏览器限制，无法扫描');
				this.showNoVideosMessage();
				return;
			}

			if (this.isYouTubeSite) {
				this.updateStatus('warning', 'YouTube 页面：已禁用');
				return;
			}

			let contentVideos = [];
			let response = await this.sendMessageWithTimeout(tab.id, { action: 'getVideos' }, 10000);

			// If content script not responding, try to inject it
			if (response && response.error && response.error.includes('Content script error')) {
				console.log('Content script not found, attempting to inject...');
				this.updateStatus('loading', '正在初始化扫描器…');

				try {
					// Inject content script manually
					await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						files: ['js/content.js']
					});

					// Wait a bit for injection to complete
					await new Promise(resolve => setTimeout(resolve, 1000));

					// Try again
					response = await this.sendMessageWithTimeout(tab.id, {
						action: 'getVideos'
					}, 10000);

				} catch (injectionError) {
					console.error('Failed to inject content script:', injectionError);
					const msg = injectionError && injectionError.message ? injectionError.message : String(injectionError);
					if (msg.includes('Cannot access a chrome://') || msg.includes('Cannot access a chrome-extension:')) {
						this.updateStatus('warning', '该页面受浏览器限制，无法扫描');
						this.showNoVideosMessage();
						return;
					}
					throw new Error('初始化扫描器失败，请刷新页面重试。');
				}
			}

			const contentOk = Boolean(response && response.success);
			if (contentOk) {
				contentVideos = response.videos || [];
			}

			const captured = await this.sendBackgroundMessage({
				action: 'getCapturedVideos',
				tabId: tab.id
			});

			const rawCapturedVideos = (captured && captured.success) ? (captured.videos || []) : [];
			const pageTitle = tab && tab.title ? tab.title : '';
			const capturedVideos = pageTitle ?
				rawCapturedVideos.map(v => Object.assign({}, v, { title: pageTitle })) :
				rawCapturedVideos;
			const merged = this.mergeVideosBySrc(contentVideos, capturedVideos);
			const normalized = merged.map(v => this.normalizeVideo(v)).filter(Boolean);
			const expanded = await this.expandHlsMasterPlaylists(normalized);
			this.videos = this.onlyDownloadable ? expanded.filter(v => this.isGoodPopupCandidate(v)) : expanded;

			if (!contentOk && this.videos.length === 0) {
				const errMsg = response && response.error ? response.error : 'Failed to get videos';
				console.warn('Content script not available:', errMsg);
				throw new Error(errMsg);
			}

			this.renderVideoList();
			this.updateStatus(
				this.videos.length ? 'success' : 'info',
				this.videos.length ? `已找到 ${this.videos.length} 个资源` : '未找到资源（请先播放几秒或点击刷新）'
			);
		} catch (error) {
			console.error('Error refreshing videos:', error);
			this.updateStatus('error', '扫描失败，请刷新页面重试');
			this.showNoVideosMessage();
		}
	}

	async expandHlsMasterPlaylists(videos) {
		const list = Array.isArray(videos) ? videos : [];
		const out = [];
		const masters = [];
		for (const v of list) {
			out.push(v);
			if (!v || !v.src) continue;
			const u = String(v.src).toLowerCase();
			if (!u.includes('.m3u8')) continue;
			if (!u.includes('playlist.m3u8')) continue;
			masters.push(v);
		}

		if (masters.length === 0) {
			return out;
		}

		const maxExpand = 3;
		const toExpand = masters.slice(0, maxExpand);

		for (const master of toExpand) {
			try {
				const variants = await this.fetchHlsVariants(master.src);
				if (!variants || variants.length === 0) {
					continue;
				}
				for (const it of variants) {
					const idBase = master.id || master.src;
					out.push(Object.assign({}, master, {
						id: `${idBase}::${it.quality}`,
						src: it.url,
						quality: it.quality,
						hlsMasterUrl: master.src
					}));
				}
			} catch (error) {
				// Ignore
			}
		}

		const seen = new Set();
		const deduped = [];
		for (const v of out) {
			if (!v || !v.src) continue;
			if (seen.has(v.src)) continue;
			seen.add(v.src);
			deduped.push(v);
		}
		return deduped;
	}

	async fetchHlsVariants(masterUrl) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 8000);
		try {
			const res = await fetch(masterUrl, { method: 'GET', credentials: 'include', signal: ctrl.signal });
			if (!res.ok) {
				return [];
			}
			const text = await res.text();
			return this.parseHlsVariants(text, masterUrl);
		} finally {
			clearTimeout(timer);
		}
	}

	parseHlsVariants(content, baseUrl) {
		const lines = String(content || '').split('\n').map(l => l.trim());
		const out = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line || !line.startsWith('#EXT-X-STREAM-INF:')) {
				continue;
			}
			const next = lines[i + 1] || '';
			if (!next || next.startsWith('#')) {
				continue;
			}
			const m = line.match(/RESOLUTION=(\d+)x(\d+)/i);
			const quality = m ? `${m[2]}p` : (this.inferQualityFromUrl(next) || '');
			if (!quality || quality === 'unknown') {
				continue;
			}
			try {
				out.push({ quality, url: new URL(next, baseUrl).href });
			} catch (error) {
				// Ignore
			}
		}
		return out;
	}

	normalizeVideo(video) {
		if (!video || !video.src) {
			return null;
		}
		const src = String(video.src);
		const quality = this.normalizeQuality(video.quality, src, video.videoWidth, video.videoHeight);
		return Object.assign({}, video, { src, quality });
	}

	isGoodPopupCandidate(video) {
		if (!video || !video.src) {
			return false;
		}
		if (this.isBlobOrDataUrl(video.src)) {
			return false;
		}
		if (!this.isLikelyDownloadUrl(video.src)) {
			return false;
		}
		return Boolean(video.quality && video.quality !== 'unknown');
	}

	isLikelyDownloadUrl(url) {
		const u = String(url || '').toLowerCase();
		// Skip HLS segments / subtitle / images / audio-only to avoid huge noisy lists (e.g. missav)
		if (u.includes('.ts') && !u.includes('.m3u8')) return false;
		if (u.includes('.vtt')) return false;
		if (u.includes('.jpg') || u.includes('.jpeg') || u.includes('.png') || u.includes('.gif') || u.includes('.webp')) return false;
		if (u.includes('.m4a') || u.includes('.mp3') || u.includes('.aac') || u.includes('.opus')) return false;
		// Allow typical video/stream entrypoints
		if (u.includes('.m3u8')) return true;
		if (u.includes('.mp4')) return true;
		if (u.includes('.webm')) return true;
		if (u.includes('.mkv')) return true;
		if (u.includes('.flv')) return true;
		if (u.includes('.mpd')) return true;
		if (u.includes('.m4s')) return true;
		// Fallback: unknown file types are treated as not candidates in popup
		return false;
	}

	normalizeQuality(quality, src, videoWidth, videoHeight) {
		const q = typeof quality === 'string' ? quality.trim().toLowerCase() : '';
		if (q && q !== 'unknown') {
			// Accept only known labels (avoid bandwidth numbers like "4745")
			if (/^\d+p$/.test(q) || q === '4k' || q === 'hd' || q === 'sd') {
				return q;
			}
		}

		const inferred = this.inferQualityFromUrl(src);
		if (inferred) {
			return inferred;
		}

		if (videoWidth && videoHeight) {
			return `${videoHeight}p`;
		}

		return 'unknown';
	}

	inferQualityFromUrl(url) {
		try {
			const u = new URL(url);
			const m = u.pathname.match(/\/(\d{3,4})x(\d{3,4})\//);
			if (m) {
				const h = Number(m[2]);
				if (Number.isFinite(h) && h > 0) {
					return `${h}p`;
				}
			}
			return '';
		} catch (error) {
			return '';
		}
	}

	async sendMessageWithTimeout(tabId, message, timeout = 5000) {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				resolve({ error: 'Timeout - Content script may not be ready' });
			}, timeout);

			chrome.tabs.sendMessage(tabId, message, (response) => {
				clearTimeout(timer);

				// Check for chrome.runtime.lastError
				if (chrome.runtime.lastError) {
					const msg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
					if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
						resolve({ error: `Content script error: ${msg}` });
						return;
					}
					console.warn('Chrome runtime error:', msg);
					resolve({
						error: `Content script error: ${msg}`
					});
					return;
				}

				// Ensure we have a valid response
				if (!response) {
					resolve({ error: 'No response from content script - may not be injected' });
					return;
				}

				resolve(response);
			});
		});
	}

	mergeVideosBySrc(a, b) {
		const map = new Map();
		const push = (list) => {
			for (const v of list) {
				if (!v || !v.src) {
					continue;
				}
				if (!map.has(v.src)) {
					map.set(v.src, v);
				}
			}
		};
		push(a || []);
		push(b || []);
		return Array.from(map.values());
	}

	isScriptableUrl(url) {
		return VDHUtils.isScriptableUrl(url);
	}

	isBlobOrDataUrl(url) {
		return VDHUtils.isBlobOrDataUrl(url);
	}

	findAlternativeDownloadUrl(video) {
		return VDHUtils.findAlternativeDownloadUrl(video, this.videos);
	}

	findBestNetworkUrl() {
		const hostname = this.currentTabHostname;
		const candidates = this.videos
			.filter(v => v && v.src && !this.isBlobOrDataUrl(v.src))
			.filter(v => !hostname || this.safeHostname(v.src) === hostname);

		if (candidates.length === 0) {
			return null;
		}

		const score = (url) => {
			const u = url.toLowerCase();
			if (u.includes('.mp4')) return 100;
			if (u.includes('.webm')) return 95;
			if (u.includes('.m3u8')) return 80;
			if (u.includes('.mpd')) return 70;
			if (u.includes('.m4s')) return 60;
			if (u.includes('.ts')) return 50;
			return 10;
		};

		candidates.sort((a, b) => score(b.src) - score(a.src));
		return candidates[0].src;
	}

	safeHostname(url) {
		try {
			return new URL(url).hostname || '';
		} catch (error) {
			return '';
		}
	}

	renderVideoList() {
		const videoList = document.getElementById('videoList');
		const noVideos = document.getElementById('noVideos');

		if (this.videos.length === 0) {
			noVideos.classList.remove('hidden');
			videoList.innerHTML = '';
			return;
		}

		noVideos.classList.add('hidden');

		// Group videos by quality and source
		const groupedVideos = this.groupVideosBySource();

		videoList.innerHTML = groupedVideos.map(group => this.renderVideoGroup(group)).join('');
	}

	groupVideosBySource() {
		const groups = new Map();

		this.videos.forEach(video => {
			const key = video.title || 'Unknown Video';

			if (!groups.has(key)) {
				groups.set(key, {
					title: key,
					videos: [],
					poster: video.poster,
					duration: video.duration
				});
			}

			groups.get(key).videos.push(video);
		});

		// Sort videos within each group by quality
		groups.forEach(group => {
			group.videos.sort((a, b) => this.compareQuality(b.quality, a.quality));
		});

		return Array.from(groups.values());
	}

	compareQuality(qualityA, qualityB) {
		const qualityOrder = {
			'4k': 4000,
			'2160p': 2160,
			'1440p': 1440,
			'1080p': 1080,
			'720p': 720,
			'480p': 480,
			'360p': 360,
			'unknown': 0
		};

		const valueA = qualityOrder[qualityA] || 0;
		const valueB = qualityOrder[qualityB] || 0;

		return valueA - valueB;
	}

	renderVideoGroup(group) {
		const posterHtml = group.poster ?
			`<img src="${group.poster}" alt="Video poster" class="w-16 h-12 object-cover rounded">` :
			`<div class="w-16 h-12 bg-gray-200 rounded flex items-center justify-center">
         <span class="text-gray-400 text-xl">📹</span>
       </div>`;

		const durationHtml = group.duration ?
			`<span class="text-xs text-gray-500">${this.formatDuration(group.duration)}</span>` : '';

		const videosHtml = group.videos.map(video => this.renderVideoOption(video)).join('');

		return `
      <div class="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow">
        <div class="flex items-start space-x-3">
          ${posterHtml}
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-medium text-gray-900 truncate" title="${group.title}">
              ${group.title}
            </h3>
            ${durationHtml}
            <div class="mt-2 space-y-1">
              ${videosHtml}
            </div>
          </div>
        </div>
      </div>
    `;
	}

	renderVideoOption(video) {
		const qualityLabel = this.getQualityLabel(video);
		const sizeInfo = this.getSizeInfo(video);
		const typeIcon = this.getTypeIcon(video.type);
		const isUndownloadable = this.isBlobOrDataUrl(video.src);
		const btnClass = isUndownloadable ? 'download-btn vdh-disabled-btn text-white text-xs px-3 py-1 rounded transition-colors' :
			'download-btn vdh-primary-btn text-white text-xs px-3 py-1 rounded transition-colors';
		const btnText = isUndownloadable ? '不可用' : '下载';

		return `
      <div class="flex items-center justify-between bg-gray-50 rounded p-2">
        <div class="flex items-center space-x-2">
          <span class="text-gray-400 text-sm">${typeIcon}</span>
          <span class="text-sm text-gray-700">${qualityLabel}</span>
          ${sizeInfo}
        </div>
        <button 
          class="${btnClass}"
          data-video-id="${video.id}"
          data-quality="${video.quality}"
          data-disabled="${isUndownloadable ? '1' : '0'}"
          data-disabled-reason="该条目是 blob/data URL，无法直接处理。请先播放几秒，点击刷新后选择 🌐 条目。"
        >
          <span class="mr-1">${isUndownloadable ? '⛔' : '⬇️'}</span>
          ${btnText}
        </button>
      </div>
    `;
	}

	async loadPreferences() {
		try {
			const result = await chrome.storage.local.get(['vdhPrefs']);
			const prefs = result && result.vdhPrefs ? result.vdhPrefs : null;
			if (prefs && typeof prefs.onlyDownloadable === 'boolean') {
				this.onlyDownloadable = prefs.onlyDownloadable;
			}
		} catch (error) {
			// Ignore
		}

		const toggle = document.getElementById('onlyDownloadableToggle');
		if (toggle) {
			toggle.checked = Boolean(this.onlyDownloadable);
		}
	}

	async savePreferences() {
		try {
			await chrome.storage.local.set({
				vdhPrefs: {
					onlyDownloadable: Boolean(this.onlyDownloadable)
				}
			});
		} catch (error) {
			// Ignore
		}
	}

	getQualityLabel(video) {
		if (video.quality && video.quality !== 'unknown') {
			return video.quality;
		}

		if (video.videoWidth && video.videoHeight) {
			return `${video.videoWidth}x${video.videoHeight}`;
		}

		return 'Unknown quality';
	}

	getSizeInfo(video) {
		if (video.bandwidth) {
			const sizeMB = Math.round(video.bandwidth / 8 / 1024 / 1024);
			return `<span class="text-xs text-gray-500">${sizeMB}MB/min</span>`;
		}
		return '';
	}

	getTypeIcon(type) {
		const iconMap = {
			'network-detected': '🌐',
			'streaming': '📺',
			'iframe-embedded': '🔗',
			'context-menu': '🖱️'
		};

		return iconMap[type] || '📹';
	}

	formatDuration(seconds) {
		if (!seconds || isNaN(seconds)) return '';

		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);

		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	async downloadVideo(videoId, quality) {
		const video = this.videos.find(v => v.id === videoId);
		if (!video) {
			this.showError('Video not found');
			return;
		}

		try {
			const tabId = this.currentTabId;
			const qs = new URLSearchParams();
			if (tabId != null) {
				qs.set('tabId', String(tabId));
			}
			qs.set('src', encodeURIComponent(video.src));
			qs.set('title', encodeURIComponent(video.title || 'Captured Video'));
			qs.set('quality', encodeURIComponent(quality || video.quality || 'unknown'));
			const masterUrl = video.hlsMasterUrl || this.deriveHlsMasterUrl(video.src);
			if (masterUrl) {
				qs.set('master', encodeURIComponent(masterUrl));
			}

			await chrome.tabs.create({
				url: chrome.runtime.getURL(`manager.html?${qs.toString()}`)
			});
			this.updateStatus('success', '已打开下载管理器');
		} catch (error) {
			console.error('Download error:', error);
			this.showError(`打开下载管理器失败：${error.message}`);
			this.hideDownloadSection();
		}
	}

	deriveHlsMasterUrl(url) {
		try {
			const u = new URL(url);
			const segs = u.pathname.split('/').filter(Boolean);
			// missav/surrit: /{id}/playlist.m3u8 or /{id}/{WxH}/video.m3u8
			if (segs.length >= 1 && segs[segs.length - 1].toLowerCase() === 'playlist.m3u8') {
				return u.href;
			}
			if (segs.length >= 3 && segs[segs.length - 1].toLowerCase() === 'video.m3u8' && /^\d{3,4}x\d{3,4}$/i.test(segs[segs.length - 2])) {
				return `${u.origin}/${segs[0]}/playlist.m3u8`;
			}
			return '';
		} catch (error) {
			return '';
		}
	}

	getVideoFormat(url) {
		const formatMap = {
			'.mp4': 'mp4',
			'.webm': 'webm',
			'.ogg': 'ogg',
			'.avi': 'avi',
			'.mov': 'mov',
			'.mkv': 'mkv',
			'.flv': 'flv',
			'.ts': 'ts',
			'.m4s': 'm4s',
			'.m3u8': 'm3u8',
			'.mpd': 'mpd'
		};

		for (const [ext, format] of Object.entries(formatMap)) {
			if (url.includes(ext)) {
				return format;
			}
		}

		return 'mp4'; // Default format
	}

	async sendBackgroundMessage(message) {
		return new Promise((resolve) => {
			chrome.runtime.sendMessage(message, (response) => {
				resolve(response || { error: 'No response from background script' });
			});
		});
	}

	async sendContentMessage(message) {
		return new Promise((resolve) => {
			// Get current active tab
			chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
				if (tabs[0]) {
					chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
						if (chrome.runtime.lastError) {
							resolve({
								error: 'Content script not available: ' + chrome.runtime.lastError.message
							});
						} else {
							resolve(response || { error: 'No response from content script' });
						}
					});
				} else {
					resolve({ error: 'No active tab found' });
				}
			});
		});
	}

	showDownloadSection() {
		document.getElementById('downloadSection').classList.remove('hidden');
	}

	hideDownloadSection() {
		document.getElementById('downloadSection').classList.add('hidden');
	}

	updateDownloadProgress(progressData) {
		const { downloadId, percentage, phase, message, bytesReceived, totalBytes } = progressData;

		// Update progress bar
		const progressBar = document.getElementById('downloadProgress');
		const progressText = document.getElementById('downloadPercentage');

		// Set progress bar width
		progressBar.style.width = `${percentage || 0}%`;
		progressText.textContent = `${percentage || 0}%`;

		// Update progress bar color based on phase
		progressBar.className = 'h-2 rounded-full transition-all duration-300';
		if (phase === 'caching') {
			progressBar.classList.add('bg-yellow-500'); // Yellow for caching
		} else if (phase === 'downloading' || phase === 'saving') {
			progressBar.classList.add('bg-blue-600'); // Blue for downloading/saving
		} else {
			progressBar.classList.add('bg-green-500'); // Green for completed
		}

		// Update status message if provided
		if (message) {
			const statusText = document.getElementById('statusText');
			statusText.textContent = message;

			// Update status icon based on phase
			const statusIcon = document.getElementById('statusIcon');
			statusIcon.innerHTML = '';

			if (phase === 'caching') {
				statusIcon.innerHTML = '<span class="text-yellow-500 animate-pulse">💾</span>';
			} else if (phase === 'downloading') {
				statusIcon.innerHTML = '<span class="text-blue-500 animate-bounce">⬇️</span>';
			} else if (phase === 'saving') {
				statusIcon.innerHTML = '<span class="text-green-500">💿</span>';
			} else {
				statusIcon.innerHTML = '<span class="text-blue-500 animate-spin">🔍</span>';
			}
		}

		// Update speed and ETA for legacy compatibility
		if (bytesReceived && totalBytes) {
			const downloadInfo = Array.from(this.currentDownloads.values())[0];
			if (downloadInfo) {
				const elapsed = (Date.now() - downloadInfo.startTime) / 1000;
				const speed = bytesReceived / elapsed;
				const remaining = (totalBytes - bytesReceived) / speed;

				document.getElementById('downloadSpeed').textContent = this.formatSpeed(speed);
				document.getElementById('downloadETA').textContent = this.formatTime(remaining);
			}
		} else {
			// Clear speed/ETA when not available
			document.getElementById('downloadSpeed').textContent = '';
			document.getElementById('downloadETA').textContent = phase ? this.getPhaseDescription(phase) : '';
		}
	}

	getPhaseDescription(phase) {
		switch (phase) {
			case 'caching':
				return 'Caching data...';
			case 'downloading':
				return 'Preparing file...';
			case 'saving':
				return 'Saving file...';
			default:
				return 'Processing...';
		}
	}

	handleDownloadComplete(data) {
		const { downloadId, downloadInfo } = data;

		this.currentDownloads.delete(downloadId);
		this.hideDownloadSection();
		this.updateStatus('success', `下载完成：${downloadInfo.title}`);
		this.loadDownloadStats(); // Refresh stats

		// Show success notification
		this.showNotification('下载完成', 'success');
	}

	handleDownloadError(data) {
		const { downloadId, error, downloadInfo, hint } = data;

		this.currentDownloads.delete(downloadId);
		this.hideDownloadSection();
		const msg = hint ? `下载失败：${error}。${hint}` : `下载失败：${error}`;
		this.updateStatus('error', msg);

		this.showError(msg);
	}

	handleVideoDetected(videoData) {
		// Add new video to the list if not already present
		const existingVideo = this.videos.find(v => v.src === videoData.src);
		if (!existingVideo) {
			this.videos.push(videoData);
			this.renderVideoList();
			this.updateStatus('success', `已找到 ${this.videos.length} 个资源`);
		}
	}

	formatSpeed(bytesPerSecond) {
		if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
		if (bytesPerSecond < 1024 * 1024) return `${Math.round(bytesPerSecond / 1024)} KB/s`;
		return `${Math.round(bytesPerSecond / 1024 / 1024)} MB/s`;
	}

	formatTime(seconds) {
		if (!seconds || seconds === Infinity) return '-- left';

		if (seconds < 60) return `${Math.round(seconds)}s left`;
		if (seconds < 3600) return `${Math.round(seconds / 60)}m left`;
		return `${Math.round(seconds / 3600)}h left`;
	}

	updateStatus(type, message) {
		const statusIcon = document.getElementById('statusIcon');
		const statusText = document.getElementById('statusText');

		// Clear existing content
		statusIcon.innerHTML = '';

		switch (type) {
			case 'loading':
				statusIcon.innerHTML = '<span class="text-blue-500 animate-spin">🔍</span>';
				break;
			case 'success':
				statusIcon.innerHTML = '<span class="text-green-500">✅</span>';
				break;
			case 'error':
				statusIcon.innerHTML = '<span class="text-red-500">❌</span>';
				break;
			case 'warning':
				statusIcon.innerHTML = '<span class="text-yellow-500">⚠️</span>';
				break;
			case 'info':
				statusIcon.innerHTML = '<span class="text-blue-500">ℹ️</span>';
				break;
		}

		statusText.textContent = message;
	}

	showError(message) {
		this.showNotification(message, 'error');
	}

	showNotification(message, type = 'info') {
		// Simple notification system (could be enhanced with a proper notification library)
		const notification = document.createElement('div');
		notification.className = `fixed top-4 right-4 p-3 rounded-lg shadow-lg z-50 ${type === 'success' ? 'bg-green-500' :
			type === 'error' ? 'bg-red-500' :
				'bg-blue-500'
			} text-white`;
		notification.textContent = message;

		document.body.appendChild(notification);

		setTimeout(() => {
			notification.remove();
		}, 3000);
	}

	async loadDownloadStats() {
		try {
			const response = await this.sendBackgroundMessage({ action: 'getDownloadStats' });
			if (response.success) {
				document.getElementById('downloadCount').textContent =
					response.stats.downloadsToday || 0;
			}
		} catch (error) {
			console.error('Error loading download stats:', error);
		}
	}

	showNoVideosMessage() {
		const noVideos = document.getElementById('noVideos');
		noVideos.classList.remove('hidden');
		document.getElementById('videoList').innerHTML = '';
	}

	openSettings() {
		const panel = document.getElementById('captureSettings');
		if (!panel) {
			return;
		}
		this.settingsVisible = !this.settingsVisible;
		if (this.settingsVisible) {
			panel.classList.remove('hidden');
			return;
		}
		panel.classList.add('hidden');
	}
}

// Initialize popup manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
	new PopupManager();
});
