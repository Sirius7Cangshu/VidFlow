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
		this.managerPrefs = { minSizeKB: 2048, concurrency: 2 };
		this.init();
	}

	async init() {
		await this.checkCurrentSite();
		await this.loadManagerPrefs();
		this.setupEventListeners();
		this.setupMessageHandler();
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
		// Refresh button
		const refreshBtn = document.getElementById('refreshBtn');
		if (refreshBtn) {
			refreshBtn.addEventListener('click', () => this.refreshVideos());
		}

		// Record mode button
		const recordBtn = document.getElementById('recordModeBtn');
		if (recordBtn) {
			recordBtn.addEventListener('click', () => this.openRecordMode());
		}

		// Filter controls
		const filterInput = document.getElementById('minSizeKB');
		const filterDecrease = document.getElementById('filterDecrease');
		const filterIncrease = document.getElementById('filterIncrease');

		if (filterInput) {
			filterInput.addEventListener('change', () => this.onFilterChange());
		}
		if (filterDecrease) {
			filterDecrease.addEventListener('click', () => this.adjustFilter(-256));
		}
		if (filterIncrease) {
			filterIncrease.addEventListener('click', () => this.adjustFilter(256));
		}

		// Video list click delegation
		const videoList = document.getElementById('videoList');
		if (videoList) {
			videoList.addEventListener('click', (e) => {
				const btn = e.target instanceof Element ? e.target.closest('.vdh-download-btn') : null;
				if (btn) {
					const videoId = btn.dataset.videoId;
					const quality = btn.dataset.quality;
					this.downloadVideo(videoId, quality);
				}
			});
		}
	}

	adjustFilter(delta) {
		const input = document.getElementById('minSizeKB');
		if (!input) return;
		const current = Number(input.value) || 0;
		const newVal = Math.max(0, current + delta);
		input.value = String(newVal);
		this.onFilterChange();
	}

	async onFilterChange() {
		const input = document.getElementById('minSizeKB');
		if (!input) return;
		const v = Number(input.value);
		if (!Number.isFinite(v) || v < 0) return;
		this.managerPrefs.minSizeKB = Math.floor(v);
		await this.persistManagerPrefs();
		await this.sendBackgroundMessage({
			action: 'updateCapturePrefs',
			prefs: { minSizeBytes: this.managerPrefs.minSizeKB * 1024 }
		});
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
		const warning = document.getElementById('youtubeWarning');
		if (warning) {
			warning.classList.remove('hidden');
		}
		this.updateStatus('warning', 'YouTube 禁止下载');
	}

	async refreshVideos() {
		this.updateStatus('loading', '正在扫描…');

		try {
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

			if (response && response.error && response.error.includes('Content script error')) {
				console.log('Content script not found, attempting to inject...');
				this.updateStatus('loading', '正在初始化扫描器…');

				try {
					await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						files: ['js/content.js']
					});
					await new Promise(resolve => setTimeout(resolve, 1000));
					response = await this.sendMessageWithTimeout(tab.id, { action: 'getVideos' }, 10000);
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
			this.videos = expanded.filter(v => this.isGoodPopupCandidate(v));

			if (!contentOk && this.videos.length === 0) {
				const errMsg = response && response.error ? response.error : 'Failed to get videos';
				console.warn('Content script not available:', errMsg);
				throw new Error(errMsg);
			}

			this.renderVideoList();
			this.updateStatus(
				this.videos.length ? 'success' : 'info',
				this.videos.length ? `已找到 ${this.videos.length} 个资源` : '未找到资源'
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
				if (!variants || variants.length === 0) continue;
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
			if (!res.ok) return [];
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
			if (!line || !line.startsWith('#EXT-X-STREAM-INF:')) continue;
			const next = lines[i + 1] || '';
			if (!next || next.startsWith('#')) continue;
			const m = line.match(/RESOLUTION=(\d+)x(\d+)/i);
			const quality = m ? `${m[2]}p` : (this.inferQualityFromUrl(next) || '');
			if (!quality || quality === 'unknown') continue;
			try {
				out.push({ quality, url: new URL(next, baseUrl).href });
			} catch (error) {
				// Ignore
			}
		}
		return out;
	}

	normalizeVideo(video) {
		if (!video || !video.src) return null;
		const src = String(video.src);
		const quality = this.normalizeQuality(video.quality, src, video.videoWidth, video.videoHeight);
		return Object.assign({}, video, { src, quality });
	}

	isGoodPopupCandidate(video) {
		if (!video || !video.src) return false;
		if (this.isBlobOrDataUrl(video.src)) return false;
		if (!this.isLikelyDownloadUrl(video.src)) return false;
		return Boolean(video.quality && video.quality !== 'unknown');
	}

	isLikelyDownloadUrl(url) {
		const u = String(url || '').toLowerCase();
		if (u.includes('.ts') && !u.includes('.m3u8')) return false;
		if (u.includes('.vtt')) return false;
		if (u.includes('.jpg') || u.includes('.jpeg') || u.includes('.png') || u.includes('.gif') || u.includes('.webp')) return false;
		if (u.includes('.m4a') || u.includes('.mp3') || u.includes('.aac') || u.includes('.opus')) return false;
		if (u.includes('.m3u8')) return true;
		if (u.includes('.mp4')) return true;
		if (u.includes('.webm')) return true;
		if (u.includes('.mkv')) return true;
		if (u.includes('.flv')) return true;
		if (u.includes('.mpd')) return true;
		if (u.includes('.m4s')) return true;
		return false;
	}

	normalizeQuality(quality, src, videoWidth, videoHeight) {
		const q = typeof quality === 'string' ? quality.trim().toLowerCase() : '';
		if (q && q !== 'unknown') {
			if (/^\d+p$/.test(q) || q === '4k' || q === 'hd' || q === 'sd') {
				return q;
			}
		}
		const inferred = this.inferQualityFromUrl(src);
		if (inferred) return inferred;
		if (videoWidth && videoHeight) return `${videoHeight}p`;
		return 'unknown';
	}

	inferQualityFromUrl(url) {
		try {
			const u = new URL(url);
			const m = u.pathname.match(/\/(\d{3,4})x(\d{3,4})\//);
			if (m) {
				const h = Number(m[2]);
				if (Number.isFinite(h) && h > 0) return `${h}p`;
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
				if (chrome.runtime.lastError) {
					const msg = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
					resolve({ error: `Content script error: ${msg}` });
					return;
				}
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
				if (!v || !v.src) continue;
				if (!map.has(v.src)) map.set(v.src, v);
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
			if (noVideos) noVideos.classList.remove('hidden');
			if (videoList) videoList.innerHTML = '';
			return;
		}

		if (noVideos) noVideos.classList.add('hidden');
		if (videoList) {
			videoList.innerHTML = this.videos.map(video => this.renderVideoItem(video)).join('');
		}
	}

	renderVideoItem(video) {
		const escapedId = this.escapeAttr(video.id || video.src);
		const escapedQuality = this.escapeAttr(video.quality || 'unknown');
		const title = this.escapeHtml(this.getVideoTitle(video));
		const typeLabel = this.getTypeLabel(video.src);
		const btnLabel = this.getDownloadButtonLabel(video.src);

		return `
			<div class="vdh-video-item">
				<div class="vdh-video-icon">🎬</div>
				<div class="vdh-video-info">
					<span class="vdh-video-type">${typeLabel}</span>
					<span class="vdh-video-title" title="${title}">${title}</span>
				</div>
				<div class="vdh-video-actions">
					<button class="vdh-download-btn" data-video-id="${escapedId}" data-quality="${escapedQuality}">
						${btnLabel}
					</button>
					<input type="checkbox" class="vdh-video-checkbox" checked>
				</div>
			</div>
		`;
	}

	getVideoTitle(video) {
		const title = video.title || 'Unknown Video';
		const quality = video.quality && video.quality !== 'unknown' ? ` ${video.quality}` : '';
		const filename = this.getFilenameFromUrl(video.src);
		return `${title.substring(0, 20)}..${quality}[${filename}]`;
	}

	getFilenameFromUrl(url) {
		try {
			const u = new URL(url);
			const parts = u.pathname.split('/').filter(Boolean);
			return parts[parts.length - 1] || 'video';
		} catch (e) {
			return 'video';
		}
	}

	getTypeLabel(url) {
		const u = String(url || '').toLowerCase();
		if (u.includes('.m3u8')) return 'HLS';
		if (u.includes('.mpd')) return 'DASH';
		if (u.includes('.mp4')) return 'MP4';
		if (u.includes('.webm')) return 'WEBM';
		return 'VIDEO';
	}

	getDownloadButtonLabel(url) {
		const u = String(url || '').toLowerCase();
		if (u.includes('.m3u8')) return '下载 - HLS';
		if (u.includes('.mpd')) return '下载 - DASH';
		return '下载';
	}

	async downloadVideo(videoId, quality) {
		const video = this.videos.find(v => (v.id || v.src) === videoId);
		if (!video) {
			this.showError('Video not found');
			return;
		}

		try {
			const tabId = this.currentTabId;
			const qs = new URLSearchParams();
			if (tabId != null) qs.set('tabId', String(tabId));
			qs.set('src', video.src);
			qs.set('title', video.title || 'Captured Video');
			qs.set('quality', quality || video.quality || 'unknown');
			const masterUrl = video.hlsMasterUrl || this.deriveHlsMasterUrl(video.src);
			if (masterUrl) qs.set('master', masterUrl);

			await chrome.tabs.create({
				url: chrome.runtime.getURL(`manager.html?${qs.toString()}`)
			});
			this.updateStatus('success', '已打开下载管理器');
		} catch (error) {
			console.error('Download error:', error);
			this.showError(`打开下载管理器失败：${error.message}`);
		}
	}

	async openRecordMode() {
		try {
			const tabId = this.currentTabId;
			const qs = new URLSearchParams();
			if (tabId != null) qs.set('tabId', String(tabId));
			qs.set('record', '1');
			await chrome.tabs.create({
				url: chrome.runtime.getURL(`manager.html?${qs.toString()}`)
			});
		} catch (error) {
			console.error('Error opening record mode:', error);
			this.showError('无法打开记录模式');
		}
	}

	deriveHlsMasterUrl(url) {
		try {
			const u = new URL(url);
			const segs = u.pathname.split('/').filter(Boolean);
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

	async sendBackgroundMessage(message) {
		return new Promise((resolve) => {
			chrome.runtime.sendMessage(message, (response) => {
				resolve(response || { error: 'No response from background script' });
			});
		});
	}

	updateDownloadProgress(progressData) {
		// Progress updates are handled in manager page
	}

	handleDownloadComplete(data) {
		this.updateStatus('success', `下载完成`);
		this.showNotification('下载完成', 'success');
	}

	handleDownloadError(data) {
		const { error, hint } = data;
		const msg = hint ? `下载失败：${error}。${hint}` : `下载失败：${error}`;
		this.updateStatus('error', msg);
		this.showError(msg);
	}

	handleVideoDetected(videoData) {
		const existingVideo = this.videos.find(v => v.src === videoData.src);
		if (!existingVideo) {
			this.videos.push(videoData);
			this.renderVideoList();
			this.updateStatus('success', `已找到 ${this.videos.length} 个资源`);
		}
	}

	updateStatus(type, message) {
		const statusIcon = document.getElementById('statusIcon');
		const statusText = document.getElementById('statusText');
		if (!statusIcon || !statusText) return;

		const icons = {
			loading: '🔍',
			success: '✅',
			error: '❌',
			warning: '⚠️',
			info: 'ℹ️'
		};

		statusIcon.textContent = icons[type] || '🔍';
		statusText.textContent = message;
	}

	showError(message) {
		this.showNotification(message, 'error');
	}

	showNotification(message, type = 'info') {
		const notification = document.createElement('div');
		const bgColor = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6';
		notification.style.cssText = `
			position: fixed; top: 10px; right: 10px; padding: 10px 16px;
			border-radius: 8px; background: ${bgColor}; color: #fff;
			font-size: 13px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
		`;
		notification.textContent = message;
		document.body.appendChild(notification);
		setTimeout(() => notification.remove(), 3000);
	}

	showNoVideosMessage() {
		const noVideos = document.getElementById('noVideos');
		const videoList = document.getElementById('videoList');
		if (noVideos) noVideos.classList.remove('hidden');
		if (videoList) videoList.innerHTML = '';
	}

	escapeHtml(s) {
		return String(s || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	escapeAttr(s) {
		return this.escapeHtml(s).replace(/`/g, '&#96;');
	}
}

// Initialize popup manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
	new PopupManager();
});
