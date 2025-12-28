class ManagerPage {
	constructor() {
		this.tabId = null;
		this.consumerTabId = null;
		this.recording = null;
		this.recordingResult = null;
		this.recordingKey = '';
		this.activeJobKey = '';
		this.preselect = null;
		this.paused = false;
		this.pauseWaiters = [];
		this.controlsEl = null;
		this.resolutionSelect = null;
		this.activeVideo = null;
		this.prefs = {
			minSizeKB: 300,
			concurrency: 2
		};
		this.pageTitle = '';
		this.pageUrl = '';
		this.jobs = new Map();
		this.results = new Map();
		this.init();
	}

	async init() {
		const params = new URLSearchParams(window.location.search);
		const tabIdStr = params.get('tabId');
		this.tabId = tabIdStr ? Number(tabIdStr) : null;

		const preselectSrc = params.get('src');
		const preselectTitle = params.get('title') || '';
		const preselectQuality = params.get('quality') || '';
		const preselectMaster = params.get('master') || '';

		this.mountControls();
		this.bindTopControls();
		document.getElementById('recordModeBtn').addEventListener('click', () => this.startRecording('', preselectTitle, preselectQuality));
		this.updateToolbarState();

		await this.loadPrefs();
		this.bindPrefsUI();

		await this.loadConsumerTabId();
		await this.loadTabMeta();
		await this.refresh();

		this.startAutoRefresh();

		if (preselectSrc) {
			this.preselect = {
				src: decodeURIComponent(preselectSrc),
				title: decodeURIComponent(preselectTitle),
				quality: decodeURIComponent(preselectQuality),
				master: preselectMaster ? decodeURIComponent(preselectMaster) : ''
			};
			await this.refresh();
		}
	}

	bindTopControls() {
		this.resolutionSelect = document.getElementById('resolutionSelect');
		const savePartialBtn = document.getElementById('savePartialBtn');
		const copyLinkBtn = document.getElementById('copyLinkBtn');
		const errorCount = document.getElementById('errorCount');

		for (const btn of document.querySelectorAll('.vdh-mgr-pill')) {
			btn.addEventListener('click', async () => {
				const v = Number(btn.getAttribute('data-concurrency') || '0');
				if (!Number.isFinite(v) || v < 1 || v > 3) {
					return;
				}
				this.prefs.concurrency = v;
				for (const b of document.querySelectorAll('.vdh-mgr-pill')) {
					b.classList.toggle('active', Number(b.getAttribute('data-concurrency') || '0') === v);
				}
				await this.persistPrefs();
			});
		}
		for (const b of document.querySelectorAll('.vdh-mgr-pill')) {
			b.classList.toggle('active', Number(b.getAttribute('data-concurrency') || '0') === this.prefs.concurrency);
		}

		if (savePartialBtn) {
			savePartialBtn.addEventListener('click', () => {
				if (!this.activeVideo) return;
				this.saveCurrentPart(this.activeVideo);
			});
		}
		if (copyLinkBtn) {
			copyLinkBtn.addEventListener('click', async () => {
				if (!this.activeVideo) return;
				try {
					const url = this.activeVideo.selectedUrl || this.activeVideo.src || '';
					if (!url) return;
					await navigator.clipboard.writeText(url);
				} catch (error) {
					// Ignore
				}
			});
		}

		if (errorCount) {
			errorCount.textContent = '0';
		}

		if (!this.resolutionSelect) {
			return;
		}
		this.resolutionSelect.addEventListener('change', () => {
			if (!this.activeVideo || !this.resolutionSelect) {
				return;
			}
			const nextUrl = this.resolutionSelect.value;
			if (!nextUrl) {
				return;
			}
			const hit = Array.isArray(this.activeVideo.variants) ? this.activeVideo.variants.find(v => v.url === nextUrl) : null;
			this.activeVideo.selectedUrl = nextUrl;
			this.activeVideo.selectedQuality = hit ? hit.label : '';

			this.results.delete(this.activeVideo.key);
			this.setJobProgress(this.activeVideo.key, 0, '');
			const job = this.jobs.get(this.activeVideo.key);
			if (job) {
				job.lastPct = 0;
				job.status = 'idle';
				job.controller = null;
				job.hls = null;
			}
			this.updateTopButtons();
		});
	}

	findRowByKey(key) {
		return document.querySelector(`[data-job-key="${CSS.escape(key)}"]`);
	}

	updateTopButtons() {
		const savePartialBtn = document.getElementById('savePartialBtn');
		const copyLinkBtn = document.getElementById('copyLinkBtn');
		if (savePartialBtn) {
			if (!this.activeVideo) {
				savePartialBtn.disabled = true;
				savePartialBtn.textContent = '保存当前部分';
			} else {
				const job = this.jobs.get(this.activeVideo.key);
				const hasPartial = Boolean(job && job.hls && job.hls.contiguousCount > 0);
				const hasFinal = this.results.has(this.activeVideo.key);
				savePartialBtn.disabled = !(hasPartial || hasFinal);
				savePartialBtn.textContent = (hasFinal || (job && job.lastPct >= 100)) ? '保存' : '保存当前部分';
			}
		}
		if (copyLinkBtn) {
			copyLinkBtn.disabled = !this.activeVideo || !(this.activeVideo.selectedUrl || this.activeVideo.src);
		}
	}

	mountControls() {
		if (this.controlsEl) {
			return;
		}
		const dock = document.getElementById('controlsDock');
		if (!dock) {
			return;
		}

		const wrap = document.createElement('div');
		wrap.className = 'vdh-controls-dock';

		const pause = document.createElement('button');
		pause.id = 'pauseBtn';
		pause.className = 'vdh-task-btn primary';
		pause.textContent = '暂停';
		pause.addEventListener('click', () => this.togglePause());

		const stop = document.createElement('button');
		stop.id = 'stopBtn';
		stop.className = 'vdh-task-btn danger';
		stop.textContent = '停止';
		stop.addEventListener('click', () => this.stopActive());

		const clear = document.createElement('button');
		clear.id = 'clearCacheBtn';
		clear.className = 'vdh-task-btn ghost';
		clear.textContent = '清理缓存';
		clear.addEventListener('click', () => this.clearCache());

		wrap.appendChild(pause);
		wrap.appendChild(stop);
		wrap.appendChild(clear);
		dock.appendChild(wrap);
		this.controlsEl = wrap;
	}

	async loadPrefs() {
		try {
			const result = await chrome.storage.local.get(['managerPrefs']);
			const prefs = result && result.managerPrefs ? result.managerPrefs : null;
			if (prefs && typeof prefs.minSizeKB === 'number') {
				this.prefs.minSizeKB = prefs.minSizeKB;
			}
			if (prefs && typeof prefs.concurrency === 'number') {
				this.prefs.concurrency = prefs.concurrency;
			}
		} catch (error) {
			// Ignore
		}

		const minSizeInput = document.getElementById('minSizeKB');
		if (minSizeInput) {
			minSizeInput.value = String(this.prefs.minSizeKB);
		}

		for (const el of document.querySelectorAll('input[name="concurrency"]')) {
			el.checked = Number(el.value) === this.prefs.concurrency;
		}

		await chrome.runtime.sendMessage({
			action: 'updateCapturePrefs',
			prefs: { minSizeBytes: this.prefs.minSizeKB * 1024 }
		});
	}

	bindPrefsUI() {
		const minSizeInput = document.getElementById('minSizeKB');
		if (minSizeInput) {
			minSizeInput.addEventListener('change', async () => {
				const v = Number(minSizeInput.value);
				if (!Number.isFinite(v) || v < 0) {
					return;
				}
				this.prefs.minSizeKB = Math.floor(v);
				await this.persistPrefs();
				await chrome.runtime.sendMessage({
					action: 'updateCapturePrefs',
					prefs: { minSizeBytes: this.prefs.minSizeKB * 1024 }
				});
				await this.refresh();
			});
		}

		for (const el of document.querySelectorAll('input[name="concurrency"]')) {
			el.addEventListener('change', async () => {
				const v = Number(el.value);
				if (Number.isFinite(v)) {
					this.prefs.concurrency = v;
					await this.persistPrefs();
				}
			});
		}
	}

	async persistPrefs() {
		try {
			await chrome.storage.local.set({ managerPrefs: this.prefs });
		} catch (error) {
			// Ignore
		}
	}

	async loadConsumerTabId() {
		try {
			const tab = await chrome.tabs.getCurrent();
			this.consumerTabId = tab && tab.id != null ? tab.id : null;
		} catch (error) {
			this.consumerTabId = null;
		}
	}

	async loadTabMeta() {
		try {
			if (this.tabId == null) {
				const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
				this.tabId = tab && tab.id != null ? tab.id : null;
			}
			if (this.tabId == null) {
				return;
			}

			const tab = await chrome.tabs.get(this.tabId);
			this.pageTitle = tab && tab.title ? tab.title : '';
			this.pageUrl = tab && tab.url ? tab.url : '';
		} catch (error) {
			// Ignore
		}
	}

	async refresh() {
		if (this.tabId == null) {
			await this.loadTabMeta();
		}
		if (this.tabId == null) {
			return;
		}

		const resp = await chrome.runtime.sendMessage({
			action: 'getCapturedVideos',
			tabId: this.tabId
		});

		const videos = resp && resp.success ? (resp.videos || []) : [];
		const displayVideos = this.normalizeCapturedVideos(videos);
		const countEl = document.getElementById('count');
		if (countEl) {
			countEl.textContent = String(displayVideos.length);
		}

		this.renderList(displayVideos);

		if (this.preselect) {
			this.startPreselect(displayVideos);
			this.preselect = null;
		}
	}

	normalizeCapturedVideos(videos) {
		const list = Array.isArray(videos) ? videos : [];
		const groups = new Map();

		for (const raw of list) {
			if (!raw || !raw.src) {
				continue;
			}
			const src = String(raw.src);
			if (!this.isLikelyManagerUrl(src)) {
				continue;
			}
			const kind = this.getKind(src);
			const title = this.pageTitle || raw.title || 'Captured Video';
			const quality = this.normalizeQuality(raw.quality, src);
			const sizeBytes = raw.sizeBytes && raw.sizeBytes > 0 ? raw.sizeBytes : 0;

			let key = src;
			if (kind === 'm3u8') {
				key = this.hlsGroupKey(src);
			}

			if (!groups.has(key)) {
				groups.set(key, {
					key,
					kind,
					title,
					sizeBytes: 0,
					variants: [],
					selectedUrl: '',
					selectedQuality: ''
				});
			}

			const g = groups.get(key);
			g.sizeBytes = Math.max(g.sizeBytes, sizeBytes);

			if (kind === 'm3u8') {
				const label = this.hlsQualityLabel(src, quality);
				if (label) {
					g.variants.push({ label, url: src });
				}
				continue;
			}

			// Direct file: keep as a single-url item
			g.selectedUrl = src;
			g.selectedQuality = quality && quality !== 'unknown' ? quality : '';
		}

		const out = [];
		for (const g of groups.values()) {
			if (g.kind === 'm3u8') {
				const dedup = new Map();
				for (const v of g.variants) {
					if (!v || !v.label || !v.url) continue;
					if (!dedup.has(v.label)) {
						dedup.set(v.label, v.url);
					}
				}
				const variants = Array.from(dedup.entries()).map(([label, url]) => ({ label, url }));
				variants.sort((a, b) => this.compareQuality(b.label, a.label));
				g.variants = variants;
				if (variants.length > 0) {
					g.selectedUrl = variants[0].url;
					g.selectedQuality = variants[0].label;
				} else {
					// Fallback to group key as URL (best-effort)
					g.selectedUrl = g.key;
					g.selectedQuality = '';
				}
			}
			out.push(g);
		}

		return out;
	}

	isLikelyManagerUrl(url) {
		const u = String(url || '').toLowerCase();
		if (u.includes('.ts') && !u.includes('.m3u8')) return false;
		if (u.includes('.vtt')) return false;
		if (u.includes('.jpg') || u.includes('.jpeg') || u.includes('.png') || u.includes('.gif') || u.includes('.webp')) return false;
		return true;
	}

	normalizeQuality(quality, src) {
		const q = typeof quality === 'string' ? quality.trim().toLowerCase() : '';
		if (q && q !== 'unknown') {
			if (/^\d+p$/.test(q) || q === '4k') {
				return q;
			}
		}
		const inferred = this.inferQualityFromUrl(src);
		return inferred || 'unknown';
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

	hlsQualityLabel(url, fallbackQuality) {
		const inferred = this.inferQualityFromUrl(url);
		if (inferred) {
			return inferred;
		}
		const q = typeof fallbackQuality === 'string' ? fallbackQuality.trim().toLowerCase() : '';
		if (q && q !== 'unknown' && /^\d+p$/.test(q)) {
			return q;
		}
		return '';
	}

	hlsGroupKey(url) {
		try {
			const u = new URL(url);
			const segs = u.pathname.split('/').filter(Boolean);
			// missav/surrit style: /{id}/playlist.m3u8 or /{id}/{WxH}/video.m3u8
			if (segs.length >= 2) {
				return `${u.origin}/${segs[0]}`;
			}
			return url;
		} catch (error) {
			return url;
		}
	}

	startPreselect(displayVideos) {
		const p = this.preselect;
		if (!p || !p.src) {
			return;
		}
		const targetSrc = String(p.src);

		// HLS: if the exact variant URL is not in captured list, fallback to matching by group key.
		// This avoids creating a second row/progress bar for the same video.
		const targetKind = this.getKind(targetSrc);
		const targetGroupKey = targetKind === 'm3u8' ? this.hlsGroupKey(targetSrc) : '';
		if (targetKind === 'm3u8' && targetGroupKey) {
			const group = displayVideos.find(v => v && v.kind === 'm3u8' && v.key === targetGroupKey);
			if (group) {
				const masterUrl = p.master || this.deriveHlsMasterUrl(targetSrc);
				if (masterUrl) {
					this.fetchHlsMasterVariants(masterUrl).then((variants) => {
						if (Array.isArray(variants) && variants.length > 0) {
							if (!Array.isArray(group.variants)) {
								group.variants = [];
							}
							for (const it of variants) {
								if (!it || !it.label || !it.url) continue;
								group.variants.push({ label: it.label, url: it.url });
							}
							const dedup = new Map();
							for (const v of group.variants) {
								if (!v || !v.label || !v.url) continue;
								if (!dedup.has(v.label)) {
									dedup.set(v.label, v.url);
								}
							}
							group.variants = Array.from(dedup.entries()).map(([l, u]) => ({ label: l, url: u }));
							group.variants.sort((a, b) => this.compareQuality(b.label, a.label));
						}
					}).catch(() => { /* Ignore */ });
				}

				const q = this.normalizeQuality(p.quality, targetSrc);
				const label = this.hlsQualityLabel(targetSrc, q) || q;
				if (label && label !== 'unknown') {
					if (!Array.isArray(group.variants)) {
						group.variants = [];
					}
					if (!group.variants.some(x => x && x.url === targetSrc)) {
						group.variants.push({ label, url: targetSrc });
						const dedup = new Map();
						for (const v of group.variants) {
							if (!v || !v.label || !v.url) continue;
							if (!dedup.has(v.label)) {
								dedup.set(v.label, v.url);
							}
						}
						group.variants = Array.from(dedup.entries()).map(([l, u]) => ({ label: l, url: u }));
						group.variants.sort((a, b) => this.compareQuality(b.label, a.label));
					}
				}

				group.selectedUrl = targetSrc;
				group.selectedQuality = this.hlsQualityLabel(targetSrc, this.normalizeQuality(p.quality, targetSrc)) || '';
				this.queueDownload(group);
				return;
			}
		}

		for (const v of displayVideos) {
			if (v.kind === 'm3u8') {
				const hit = v.variants.find(x => x && x.url === targetSrc);
				if (hit) {
					v.selectedUrl = hit.url;
					v.selectedQuality = hit.label;
					this.queueDownload(v);
					return;
				}
			}
			if (v.selectedUrl === targetSrc || v.key === targetSrc) {
				const q = this.normalizeQuality(p.quality, targetSrc);
				if (q && q !== 'unknown') {
					v.selectedQuality = q;
				}
				this.queueDownload(v);
				return;
			}
		}

		// Fallback: create a synthetic item
		const kind = this.getKind(targetSrc);
		const key = kind === 'm3u8' ? this.hlsGroupKey(targetSrc) : targetSrc;
		const quality = this.normalizeQuality(p.quality, targetSrc);
		const synthetic = {
			key,
			kind,
			title: p.title || this.pageTitle || 'Captured Video',
			sizeBytes: 0,
			variants: kind === 'm3u8' ? [{ label: this.hlsQualityLabel(targetSrc, quality) || quality, url: targetSrc }] : [],
			selectedUrl: targetSrc,
			selectedQuality: kind === 'm3u8' ? (this.hlsQualityLabel(targetSrc, quality) || '') : (quality !== 'unknown' ? quality : '')
		};
		const list = document.getElementById('list');
		if (list) {
			list.prepend(this.renderRow(synthetic));
			const countEl = document.getElementById('count');
			if (countEl) {
				const n = Number(countEl.textContent || '0');
				countEl.textContent = String(n + 1);
			}
		}
		this.queueDownload(synthetic);
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

	async fetchHlsMasterVariants(masterUrl) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 10000);
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
			const label = m ? `${m[2]}p` : (this.inferQualityFromUrl(next) || '');
			if (!label) {
				continue;
			}
			try {
				out.push({ label, url: new URL(next, baseUrl).href });
			} catch (error) {
				// Ignore
			}
		}
		return out;
	}

	startAutoRefresh() {
		setInterval(async () => {
			if (this.recording) {
				return;
			}
			if (this.results.size > 0) {
				return;
			}
			for (const job of this.jobs.values()) {
				if (job.status === 'running') {
					return;
				}
			}
			await this.refresh();
		}, 2000);
	}

	updateToolbarState() {
		const pauseBtn = document.getElementById('pauseBtn');
		const stopBtn = document.getElementById('stopBtn');
		const clearBtn = document.getElementById('clearCacheBtn');
		if (!pauseBtn || !stopBtn || !clearBtn) {
			return;
		}

		const hasActive = Boolean(this.recording) || (this.activeJobKey && this.jobs.get(this.activeJobKey)?.status === 'running');
		pauseBtn.disabled = !hasActive;
		stopBtn.disabled = !hasActive;
		pauseBtn.style.opacity = hasActive ? '1' : '0.4';
		stopBtn.style.opacity = hasActive ? '1' : '0.4';

		const dockKey = this.activeVideo && this.activeVideo.key ? this.activeVideo.key : (this.activeJobKey || '');
		this.dockControlsTo(dockKey);

		if (this.recording && this.recording.recorder && this.recording.recorder.state === 'paused') {
			pauseBtn.textContent = '继续';
			return;
		}
		if (this.paused) {
			pauseBtn.textContent = '继续';
			return;
		}
		pauseBtn.textContent = '暂停';
		this.updateTopButtons();
	}

	dockControlsTo(key) {
		if (!this.controlsEl) {
			return;
		}
		const target = key ? this.jobs.get(key)?.controlsSlot : null;
		const fallback = document.getElementById('controlsDock');
		if (target && target instanceof Element) {
			target.appendChild(this.controlsEl);
			return;
		}
		if (fallback) {
			fallback.appendChild(this.controlsEl);
		}
	}

	updateResolutionSelect(video) {
		if (!this.resolutionSelect) {
			return;
		}
		if (!video || !Array.isArray(video.variants) || video.variants.length === 0) {
			this.resolutionSelect.innerHTML = '<option value="">-</option>';
			this.resolutionSelect.disabled = true;
			return;
		}
		const opts = video.variants
			.filter(v => v && v.label && v.url)
			.sort((a, b) => this.compareQuality(b.label, a.label));
		this.resolutionSelect.innerHTML = opts.map(v => `<option value="${this.escapeAttr(v.url)}">${this.escapeHtml(v.label)}</option>`).join('');
		this.resolutionSelect.value = video.selectedUrl || opts[0].url;
		this.resolutionSelect.disabled = false;
		this.updateTopButtons();
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

	togglePause() {
		if (this.recording && this.recording.recorder) {
			if (this.recording.recorder.state === 'recording') {
				this.recording.recorder.pause();
				this.updateToolbarState();
				return;
			}
			if (this.recording.recorder.state === 'paused') {
				this.recording.recorder.resume();
				this.updateToolbarState();
				return;
			}
			return;
		}

		if (!this.activeJobKey || this.jobs.get(this.activeJobKey)?.status !== 'running') {
			return;
		}

		if (this.paused) {
			this.resumeDownload();
			return;
		}
		this.pauseDownload();
	}

	pauseDownload() {
		this.paused = true;
		this.updateToolbarState();
	}

	resumeDownload() {
		this.paused = false;
		const waiters = this.pauseWaiters;
		this.pauseWaiters = [];
		for (const w of waiters) {
			w();
		}
		this.updateToolbarState();
	}

	waitIfPaused() {
		if (!this.paused) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.pauseWaiters.push(resolve);
		});
	}

	stopActive() {
		if (this.recording) {
			this.stopRecording();
			return;
		}
		if (!this.activeJobKey) {
			return;
		}
		this.stopJob(this.activeJobKey);
	}

	stopJob(key) {
		const job = this.jobs.get(key);
		if (job && job.controller) {
			job.controller.abort();
		}
		if (job) {
			job.status = 'idle';
			job.controller = null;
			job.lastPct = 0;
			job.hls = null;
		}
		this.results.delete(key);
		this.setJobProgress(key, 0, '已停止');
		this.paused = false;
		this.updateToolbarState();
		this.updateTopButtons();
	}

	clearCache() {
		if (this.recording) {
			this.stopRecording();
		}
		for (const key of this.jobs.keys()) {
			const job = this.jobs.get(key);
			if (job && job.status === 'running') {
				this.stopJob(key);
			}
		}

		this.results.clear();
		this.recordingResult = null;
		this.recordingKey = '';
		// Keep selection, but clear any partial download cache so user cannot "continue".
		if (this.activeVideo && this.activeVideo.key) {
			this.activeJobKey = this.activeVideo.key;
		}
		this.paused = false;

		for (const [key, job] of this.jobs.entries()) {
			job.status = 'idle';
			job.controller = null;
			job.lastPct = 0;
			job.bar.style.width = '0%';
			job.pct.textContent = '0%';
			job.text.textContent = '';
			job.hls = null;
		}
		this.updateToolbarState();
		this.updateTopButtons();
	}

	renderList(videos) {
		const empty = document.getElementById('empty');
		const list = document.getElementById('list');
		list.innerHTML = '';

		if (!videos || videos.length === 0) {
			empty.classList.remove('hidden');
			return;
		}
		empty.classList.add('hidden');

		for (const v of videos) {
			list.appendChild(this.renderRow(v));
		}
	}

	renderRow(video) {
		const row = document.createElement('div');
		row.className = 'p-4';
		row.setAttribute('data-job-key', video.key);

		const left = document.createElement('div');
		left.className = 'min-w-0 flex-1';

		const title = document.createElement('div');
		title.className = 'text-sm font-semibold text-gray-900 truncate';
		title.textContent = video.title || this.pageTitle || 'Captured Video';

		const meta = document.createElement('div');
		meta.className = 'mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1';
		if (video.sizeBytes && video.sizeBytes > 0) {
			const s = document.createElement('span');
			s.textContent = this.formatBytes(video.sizeBytes);
			meta.appendChild(s);
		}

		const kind = video.kind || this.getKind(video.selectedUrl || video.src || '');
		const type = document.createElement('span');
		type.textContent = this.getTypeLabel(kind);
		meta.appendChild(type);

		if (video.selectedQuality) {
			const q = document.createElement('span');
			q.textContent = `清晰度：${video.selectedQuality}`;
			meta.appendChild(q);
		}

		const url = document.createElement('div');
		url.className = 'mt-2 text-xs text-gray-500 truncate';
		url.textContent = video.selectedUrl || video.src || '';

		const top = document.createElement('div');
		top.className = 'flex items-start justify-between gap-4';

		left.appendChild(title);
		left.appendChild(meta);
		left.appendChild(url);

		let rightSlot = null;

		const progress = document.createElement('div');
		progress.className = 'mt-3';

		const progressEl = this.renderProgress(video.key, null, kind);
		const actions = document.createElement('div');
		actions.className = 'vdh-row-actions';

		const controlsSlot = document.createElement('div');
		controlsSlot.className = 'vdh-row-actions-left';

		actions.appendChild(controlsSlot);
		if (rightSlot) {
			actions.appendChild(rightSlot);
		} else {
			const spacer = document.createElement('div');
			spacer.className = 'vdh-row-actions-right';
			actions.appendChild(spacer);
		}

		progress.appendChild(progressEl);
		progress.appendChild(actions);

		const job = this.jobs.get(video.key);
		if (job) {
			job.controlsSlot = controlsSlot;
			job.video = video;
		}

		top.appendChild(left);
		row.appendChild(top);
		row.appendChild(progress);

		row.addEventListener('click', (e) => {
			if (e.target instanceof Element && e.target.closest('button')) {
				return;
			}
			this.activeVideo = video;
			this.updateResolutionSelect(video);
			this.updateTopButtons();
			this.queueDownload(video);
		});

		return row;
	}

	renderProgress(key, actionBtn, kind) {
		const container = document.createElement('div');
		container.className = 'w-full';

		const row = document.createElement('div');
		row.className = 'vdh-progress-row';

		const track = document.createElement('div');
		track.className = 'vdh-progress-track';

		const bar = document.createElement('div');
		bar.className = 'vdh-progress-bar';
		bar.style.width = '0%';

		const right = document.createElement('div');
		right.className = 'vdh-progress-right';

		const pct = document.createElement('div');
		pct.className = 'vdh-progress-percent';
		pct.textContent = '0%';

		const text = document.createElement('div');
		text.className = 'vdh-progress-stage';
		text.textContent = '';

		track.appendChild(bar);
		right.appendChild(pct);
		right.appendChild(text);
		row.appendChild(track);
		row.appendChild(right);
		container.appendChild(row);

		this.jobs.set(key, { container, controlsSlot: null, bar, pct, text, kind, video: null, hls: null, status: 'idle', lastPct: 0, controller: null });
		return container;
	}

	setJobProgress(key, percentage, message) {
		const job = this.jobs.get(key);
		if (!job) {
			return;
		}
		const isFailure = typeof message === 'string' && message.startsWith('失败');
		let pct = Math.max(0, Math.min(100, Number(percentage) || 0));
		if (!isFailure && typeof job.lastPct === 'number' && pct < job.lastPct) {
			pct = job.lastPct;
		}
		job.lastPct = pct;

		job.bar.style.width = `${pct}%`;
		job.pct.textContent = `${pct}%`;
		job.text.textContent = message || '';
	}

	queueDownload(video) {
		const key = video && video.key ? video.key : (video && video.src ? video.src : '');
		const url = video && (video.selectedUrl || video.src) ? (video.selectedUrl || video.src) : '';
		if (!key || !url) {
			return;
		}
		const job = this.jobs.get(key);
		if (job && job.status === 'running') {
			return;
		}
		if (job) {
			job.lastPct = 0;
			job.bar.style.width = '0%';
			job.pct.textContent = '0%';
			job.text.textContent = '';
			job.status = 'running';
			job.kind = video.kind || this.getKind(url);
			job.video = video;
		}
		this.activeJobKey = key;
		this.activeVideo = video;
		this.updateResolutionSelect(video);
		this.updateToolbarState();
		this.updateTopButtons();

		const title = video.title || this.pageTitle || 'video';
		const quality = video.selectedQuality || video.quality || 'unknown';
		this.setJobProgress(key, 0, '下载分片…');
		this.runDownload(key, url, title, quality).catch((error) => {
			if (error && error.name === 'AbortError') {
				this.setJobProgress(key, 0, '已停止');
			} else {
				this.setJobProgress(key, 0, `失败：${error && error.message ? error.message : String(error)}`);
			}
			const j = this.jobs.get(key);
			if (j) {
				j.status = 'idle';
				j.controller = null;
			}
			if (this.activeJobKey === key) {
				this.updateToolbarState();
			}
		});
	}

	async runDownload(key, url, title, quality) {
		const job = this.jobs.get(key);
		if (job) {
			job.controller = new AbortController();
		}
		const kind = this.getKind(url);
		if (job) {
			job.kind = kind;
		}
		this.setJobProgress(key, 0, `准备中…`);

		if (kind === 'm3u8') {
			await this.downloadM3U8AsTS(key, url, title, quality);
			return;
		}

		if (kind === 'dash') {
			this.setJobProgress(key, 0, '暂不支持 DASH (.mpd/.m4s)');
			return;
		}

		await this.downloadBinary(key, url, title, quality);
	}

	getKind(url) {
		const u = url.toLowerCase();
		if (u.includes('.m3u8')) return 'm3u8';
		if (u.includes('.mpd') || u.includes('.m4s')) return 'dash';
		return 'file';
	}

	getTypeLabel(kind) {
		if (kind === 'm3u8') return 'HLS (.m3u8)';
		if (kind === 'dash') return 'DASH (.mpd/.m4s)';
		return '直链文件';
	}

	compareQuality(qualityA, qualityB) {
		const order = {
			'4k': 4000,
			'2160p': 2160,
			'1440p': 1440,
			'1080p': 1080,
			'720p': 720,
			'480p': 480,
			'360p': 360
		};
		const a = typeof qualityA === 'string' ? qualityA.trim().toLowerCase() : '';
		const b = typeof qualityB === 'string' ? qualityB.trim().toLowerCase() : '';
		const va = order[a] || 0;
		const vb = order[b] || 0;
		return va - vb;
	}

	async startRecording(key, title, quality) {
		if (this.recording) {
			return;
		}
		if (this.tabId == null) {
			return;
		}

		if (key) {
			this.recordingKey = key;
			this.activeJobKey = key;
		} else {
			this.recordingKey = `recording://${Date.now()}`;
			this.activeJobKey = this.recordingKey;
			this.ensureRecordingRow(this.recordingKey, title, quality);
		}
		this.updateToolbarState();

		const suggestedTitle = title || this.pageTitle || 'recording';
		const suggestedQuality = quality || 'unknown';

		let stream;
		try {
			const streamId = await this.getTabStreamId(this.tabId);
			stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					mandatory: {
						chromeMediaSource: 'tab',
						chromeMediaSourceId: streamId
					}
				},
				video: {
					mandatory: {
						chromeMediaSource: 'tab',
						chromeMediaSourceId: streamId
					}
				}
			});
		} catch (error) {
			this.recordingKey = '';
			this.activeJobKey = '';
			this.updateToolbarState();
			return;
		}

		const mimeType = this.pickRecordingMimeType();
		const chunks = [];
		const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

		recorder.ondataavailable = (e) => {
			if (e && e.data && e.data.size > 0) {
				chunks.push(e.data);
			}
		};

		recorder.onstop = async () => {
			try {
				const finalMime = recorder.mimeType || (mimeType || 'video/webm');
				const ext = finalMime.includes('mp4') ? 'mp4' : 'webm';
				const blob = new Blob(chunks, { type: finalMime });
				const recordKey = this.recordingKey || `recording://${Date.now()}`;
				this.results.set(recordKey, {
					blob,
					filename: this.buildFilename(suggestedTitle, suggestedQuality, ext)
				});
				this.setJobProgress(recordKey, 100, '录制完成，可点击“保存”');
				this.enableSave(recordKey);
			} finally {
				stream.getTracks().forEach(t => t.stop());
				this.recording = null;
				this.recordingKey = '';
				this.paused = false;
				this.updateToolbarState();
			}
		};

		this.recording = { recorder };
		this.setJobProgress(this.recordingKey, 1, '录制中…');
		recorder.start(1000);
	}

	stopRecording() {
		if (!this.recording) {
			return;
		}
		this.recording.recorder.stop();
	}

	pickRecordingMimeType() {
		const candidates = [
			'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
			'video/webm;codecs=vp9,opus',
			'video/webm;codecs=vp8,opus',
			'video/webm'
		];
		for (const c of candidates) {
			if (MediaRecorder.isTypeSupported(c)) {
				return c;
			}
		}
		return '';
	}

	getTabStreamId(targetTabId) {
		return new Promise((resolve, reject) => {
			chrome.tabCapture.getMediaStreamId({
				targetTabId: targetTabId,
				consumerTabId: this.consumerTabId || undefined
			}, (streamId) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
					return;
				}
				resolve(streamId);
			});
		});
	}

	async downloadBinary(key, url, title, quality) {
		this.setJobProgress(key, 0, '开始下载…');

		const head = await this.probeRangeSupport(key, url);
		if (head && head.totalBytes > 0 && head.acceptRanges) {
			await this.downloadBinaryByRanges(key, url, title, quality, head.totalBytes, head.contentType);
			return;
		}

		const signal = this.jobs.get(key)?.controller?.signal;
		const res = await fetch(url, { method: 'GET', credentials: 'include', signal });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const total = Number(res.headers.get('content-length') || 0);
		const reader = res.body ? res.body.getReader() : null;
		const chunks = [];
		let loaded = 0;

		if (reader) {
			while (true) {
				await this.waitIfPaused();
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				loaded += value.byteLength;
				if (total > 0) {
					const p = Math.round((loaded / total) * 100);
					this.setJobProgress(key, p, '下载中…');
				}
			}
		} else {
			const buf = await res.arrayBuffer();
			chunks.push(new Uint8Array(buf));
			loaded = buf.byteLength;
		}

		this.setJobProgress(key, 98, '处理中…');
		const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
		this.results.set(key, { blob, filename: this.buildFilename(title, quality, this.guessExt(url, blob.type)) });
		this.setJobProgress(key, 100, '处理完成，可点击“保存”');
		this.enableSave(key);
	}

	async probeRangeSupport(key, url) {
		try {
			const jobSignal = this.jobs.get(key)?.controller?.signal;
			const probe = new AbortController();
			const timer = setTimeout(() => probe.abort(), 8000);
			if (jobSignal) {
				jobSignal.addEventListener('abort', () => probe.abort(), { once: true });
			}
			const r = await fetch(url, {
				method: 'GET',
				credentials: 'include',
				headers: { Range: 'bytes=0-0' },
				signal: probe.signal
			});
			clearTimeout(timer);
			const contentRange = r.headers.get('content-range') || '';
			const m = contentRange.match(/\/(\d+)$/);
			const totalBytes = m ? Number(m[1]) : 0;
			const acceptRanges = (r.headers.get('accept-ranges') || '').toLowerCase().includes('bytes') || r.status === 206;
			const contentType = r.headers.get('content-type') || '';
			return { totalBytes, acceptRanges, contentType };
		} catch (error) {
			return null;
		}
	}

	async downloadBinaryByRanges(key, url, title, quality, totalBytes, contentType) {
		const concurrency = Math.max(1, Math.min(3, this.prefs.concurrency));
		const chunkSize = 2 * 1024 * 1024;
		const parts = Math.ceil(totalBytes / chunkSize);

		this.setJobProgress(key, 0, 'Range 分段下载…');

		const results = new Array(parts);
		let downloadedBytes = 0;

		const fetchPart = async (index) => {
			await this.waitIfPaused();
			const start = index * chunkSize;
			const end = Math.min(totalBytes - 1, start + chunkSize - 1);
			const signal = this.jobs.get(key)?.controller?.signal;
			const r = await fetch(url, {
				method: 'GET',
				credentials: 'include',
				headers: { Range: `bytes=${start}-${end}` },
				signal
			});
			if (!(r.ok || r.status === 206)) {
				throw new Error(`Part HTTP ${r.status}`);
			}
			results[index] = new Uint8Array(await r.arrayBuffer());
			downloadedBytes += results[index].byteLength;
			let pct = Math.floor((downloadedBytes / totalBytes) * 100);
			if (pct === 0 && downloadedBytes > 0) {
				pct = 1;
			}
			this.setJobProgress(key, pct, 'Range 分段下载…');
		};

		let next = 0;
		const worker = async () => {
			while (next < parts) {
				const i = next;
				next++;
				await fetchPart(i);
			}
		};

		const workers = [];
		for (let i = 0; i < concurrency; i++) {
			workers.push(worker());
		}
		await Promise.all(workers);

		this.setJobProgress(key, 98, '合并中…');
		const blob = new Blob(results, { type: contentType || 'application/octet-stream' });
		this.results.set(key, { blob, filename: this.buildFilename(title, quality, this.guessExt(url, contentType)) });
		this.setJobProgress(key, 100, '处理完成，可点击“保存”');
		this.enableSave(key);
	}

	async downloadDashAsMp4(key, url, title, quality) {
		const u = String(url || '').toLowerCase();
		if (u.includes('.mpd')) {
			throw new Error('暂不支持 MPD 解析，请播放视频让 .m4s 出现后再试');
		}

		const job = this.jobs.get(key);
		const v = job && job.video ? job.video : null;
		let videoUrl = url;
		let audioUrl = v && v.dashAudioUrl ? String(v.dashAudioUrl) : '';
		if (audioUrl && audioUrl === videoUrl) {
			audioUrl = '';
		}
		if (!audioUrl) {
			throw new Error('未找到音频流（请确保捕获到 audio.m4s）');
		}

		this.setJobProgress(key, 0, '下载视频…');
		const videoBytes = await this.downloadBinaryToUint8Array(key, videoUrl, 0, 45, '下载视频…');
		this.setJobProgress(key, 45, '下载音频…');
		const audioBytes = await this.downloadBinaryToUint8Array(key, audioUrl, 45, 90, '下载音频…');

		this.setJobProgress(key, 92, '合并为 MP4…');
		const dur = Math.max(this.sumSidxDurationSeconds(videoBytes), this.sumSidxDurationSeconds(audioBytes));
		const parts = this.muxDashFmp4ToMp4Parts(videoBytes, audioBytes, dur);
		const blob = new Blob(parts, { type: 'video/mp4' });
		this.results.set(key, { blob, filename: this.buildFilename(title, quality, 'mp4') });
		this.setJobProgress(key, 100, '处理完成，可点击“保存”');
		this.enableSave(key);
	}

	async downloadBinaryToUint8Array(key, url, pctStart, pctEnd, stage) {
		const startPct = Math.max(0, Math.min(100, Number(pctStart) || 0));
		const endPct = Math.max(0, Math.min(100, Number(pctEnd) || 0));
		const span = Math.max(0, endPct - startPct);

		const head = await this.probeRangeSupport(key, url);
		if (head && head.totalBytes > 0 && head.acceptRanges) {
			const concurrency = Math.max(1, Math.min(3, this.prefs.concurrency));
			const chunkSize = 2 * 1024 * 1024;
			const parts = Math.ceil(head.totalBytes / chunkSize);
			const results = new Array(parts);
			let downloadedBytes = 0;

			const fetchPart = async (index) => {
				await this.waitIfPaused();
				const start = index * chunkSize;
				const end = Math.min(head.totalBytes - 1, start + chunkSize - 1);
				const signal = this.jobs.get(key)?.controller?.signal;
				const r = await fetch(url, {
					method: 'GET',
					credentials: 'include',
					headers: { Range: `bytes=${start}-${end}` },
					signal
				});
				if (!(r.ok || r.status === 206)) {
					throw new Error(`Part HTTP ${r.status}`);
				}
				results[index] = new Uint8Array(await r.arrayBuffer());
				downloadedBytes += results[index].byteLength;
				let pct = head.totalBytes > 0 ? Math.floor((downloadedBytes / head.totalBytes) * 100) : 0;
				if (pct === 0 && downloadedBytes > 0) pct = 1;
				const scaled = startPct + Math.floor(span * (pct / 100));
				this.setJobProgress(key, scaled, stage || '');
			};

			let next = 0;
			const worker = async () => {
				while (next < parts) {
					const i = next;
					next++;
					await fetchPart(i);
				}
			};

			const workers = [];
			for (let i = 0; i < concurrency; i++) {
				workers.push(worker());
			}
			await Promise.all(workers);

			const out = new Uint8Array(head.totalBytes);
			let offset = 0;
			for (const part of results) {
				out.set(part, offset);
				offset += part.byteLength;
			}
			return out;
		}

		const signal = this.jobs.get(key)?.controller?.signal;
		const res = await fetch(url, { method: 'GET', credentials: 'include', signal });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const total = Number(res.headers.get('content-length') || 0);
		const reader = res.body ? res.body.getReader() : null;
		const chunks = [];
		let loaded = 0;

		if (reader) {
			while (true) {
				await this.waitIfPaused();
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				loaded += value.byteLength;
				if (total > 0) {
					const pct = Math.floor((loaded / total) * 100);
					const scaled = startPct + Math.floor(span * (pct / 100));
					this.setJobProgress(key, scaled, stage || '');
				}
			}
		} else {
			const buf = await res.arrayBuffer();
			chunks.push(new Uint8Array(buf));
			loaded = buf.byteLength;
		}

		const out = new Uint8Array(loaded);
		let offset = 0;
		for (const c of chunks) {
			out.set(c, offset);
			offset += c.byteLength;
		}
		return out;
	}

	sumSidxDurationSeconds(bytes) {
		try {
			const boxes = this.parseMp4Boxes(bytes, 0, bytes.byteLength);
			const sidx = boxes.find(b => b && b.type === 'sidx');
			if (!sidx) return 0;

			const start = sidx.payloadStart;
			const end = sidx.boxEnd;
			if (start + 4 + 4 + 4 > end) return 0;
			const version = bytes[start];
			const timescale = this.readU32(bytes, start + 4 + 4);
			if (!timescale) return 0;

			let p = start + 4 + 4 + 4;
			if (version === 0) {
				p += 4 + 4;
			} else {
				p += 8 + 8;
			}
			if (p + 4 > end) return 0;
			const refCount = (bytes[p + 2] << 8) | bytes[p + 3];
			p += 4; // reserved(2) + reference_count(2)

			let total = 0;
			for (let i = 0; i < refCount && p + 12 <= end; i++) {
				const subDur = this.readU32(bytes, p + 4);
				total += subDur;
				p += 12;
			}
			return Math.max(0, Math.round((total / timescale) * 1000) / 1000);
		} catch (error) {
			return 0;
		}
	}

	muxDashFmp4ToMp4Parts(videoBytes, audioBytes, durationSec) {
		const vInfo = this.extractFmp4Info(videoBytes);
		const aInfo = this.extractFmp4Info(audioBytes);

		const vTrackId = this.readTrackIdFromFirstTrak(vInfo.moov);
		const aTrackId = this.readTrackIdFromFirstTrak(aInfo.moov);
		if (!vTrackId || !aTrackId) {
			throw new Error('无法解析 Track ID');
		}

		let newAudioTrackId = aTrackId;
		if (aTrackId === vTrackId) {
			newAudioTrackId = aTrackId + 1;
		}

		const audioTrakBoxes = this.extractTrakBoxes(aInfo.moov);
		if (audioTrakBoxes.length === 0) {
			throw new Error('缺少音频 trak');
		}
		for (const trak of audioTrakBoxes) {
			this.patchTrakTrackId(trak, newAudioTrackId);
		}

		const audioTrex = this.extractTrexBoxes(aInfo.moov);
		if (audioTrex.length === 0) {
			throw new Error('缺少音频 trex');
		}
		for (const trex of audioTrex) {
			this.patchTrexTrackId(trex, newAudioTrackId);
		}

		const mergedMoov = this.mergeMoovWithAudio(vInfo.moov, audioTrakBoxes, audioTrex);
		const init = this.concatUint8([vInfo.ftyp, mergedMoov]);
		const patchedInit = durationSec > 0 ? this.patchMp4InitDuration(init, durationSec) : init;
		const timescales = this.extractTrackTimescales(mergedMoov);

		const videoFrags = vInfo.fragments.map(f => ({ data: f, kind: 'video' }));
		const audioFrags = aInfo.fragments.map(f => ({ data: f, kind: 'audio' }));

		const all = [];
		for (const f of videoFrags) {
			const info = this.readMoofInfo(f.data);
			if (!info) {
				throw new Error('无法解析 video moof');
			}
			all.push({ data: f.data, info, kind: 'video' });
		}
		for (const f of audioFrags) {
			const info = this.readMoofInfo(f.data);
			if (!info) {
				throw new Error('无法解析 audio moof');
			}
			all.push({ data: f.data, info, kind: 'audio' });
		}
		if (all.length === 0) {
			throw new Error('未找到 media fragments');
		}

		const trackMap = new Map();
		if (newAudioTrackId !== aTrackId) {
			trackMap.set(aTrackId, newAudioTrackId);
		}

		for (const it of all) {
			if (!it.info) continue;
			const mapped = trackMap.has(it.info.trackId) ? newAudioTrackId : it.info.trackId;
			it.info.trackId = mapped;
			const ts = timescales.get(mapped) || 0;
			if (!ts) {
				throw new Error('缺少 track timescale');
			}
			it.timescale = ts;
			it.timeUs = (it.info.decodeTime * 1000000n) / BigInt(ts);
		}

		let baseUs = null;
		for (const it of all) {
			if (it.timeUs == null) continue;
			if (baseUs == null || it.timeUs < baseUs) {
				baseUs = it.timeUs;
			}
		}
		if (baseUs == null) {
			baseUs = 0n;
		}

		for (const it of all) {
			if (!it.info) continue;
			const ts = BigInt(it.timescale || 1);
			const adjUs = (it.timeUs || 0n) - baseUs;
			it.info.decodeTime = (adjUs * ts) / 1000000n;
		}

		all.sort((a, b) => {
			if (a.timeUs === b.timeUs) {
				return a.kind === 'video' ? -1 : 1;
			}
			return a.timeUs < b.timeUs ? -1 : 1;
		});

		let seq = 1;
		for (const it of all) {
			if (!it.info) continue;
			this.patchMoofInPlace(it.data, {
				sequenceNumber: seq,
				newTrackId: it.info.trackId,
				decodeTime: it.info.decodeTime
			});
			seq++;
		}

		return [patchedInit, ...all.map(x => x.data)];
	}

	parseMp4Boxes(bytes, start, end) {
		const out = [];
		let offset = start || 0;
		const limit = typeof end === 'number' ? end : bytes.byteLength;
		while (offset + 8 <= limit) {
			let size = this.readU32(bytes, offset);
			const type = this.readType(bytes, offset + 4);
			let header = 8;
			if (size === 1) {
				if (offset + 16 > limit) break;
				size = Number(this.readU64(bytes, offset + 8));
				header = 16;
			} else if (size === 0) {
				size = limit - offset;
			}
			if (size < header || offset + size > limit) {
				break;
			}
			out.push({
				type,
				offset,
				size,
				header,
				payloadStart: offset + header,
				boxEnd: offset + size
			});
			offset += size;
		}
		return out;
	}

	concatUint8(parts) {
		const list = Array.isArray(parts) ? parts : [];
		let total = 0;
		for (const p of list) {
			if (!p || !p.byteLength) continue;
			total += p.byteLength;
		}
		const out = new Uint8Array(total);
		let offset = 0;
		for (const p of list) {
			if (!p || !p.byteLength) continue;
			out.set(p, offset);
			offset += p.byteLength;
		}
		return out;
	}

	makeBox(type, payload) {
		const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
		const size = 8 + body.byteLength;
		const out = new Uint8Array(size);
		this.writeU32(out, 0, size >>> 0);
		out[4] = type.charCodeAt(0) & 0xff;
		out[5] = type.charCodeAt(1) & 0xff;
		out[6] = type.charCodeAt(2) & 0xff;
		out[7] = type.charCodeAt(3) & 0xff;
		out.set(body, 8);
		return out;
	}

	extractFmp4Info(bytes) {
		const boxes = this.parseMp4Boxes(bytes, 0, bytes.byteLength);
		const ftyp = boxes.find(b => b && b.type === 'ftyp');
		const moov = boxes.find(b => b && b.type === 'moov');
		if (!ftyp || !moov) {
			throw new Error('缺少 ftyp/moov');
		}
		const moovBytes = bytes.subarray(moov.offset, moov.boxEnd);

		const fragments = [];
		for (let i = 0; i < boxes.length; i++) {
			const b = boxes[i];
			if (!b || b.type !== 'moof') continue;
			let end = b.boxEnd;
			for (let j = i + 1; j < boxes.length; j++) {
				const nb = boxes[j];
				if (!nb) continue;
				if (nb.type === 'moof') break;
				end = nb.boxEnd;
				if (nb.type === 'mdat') break;
			}
			if (end > b.offset) {
				fragments.push(bytes.subarray(b.offset, end));
			}
		}

		return {
			ftyp: bytes.subarray(ftyp.offset, ftyp.boxEnd),
			moov: moovBytes,
			fragments
		};
	}

	readTrackIdFromFirstTrak(moovBytes) {
		const top = this.parseMp4Boxes(moovBytes, 0, moovBytes.byteLength);
		const moov = top.find(b => b && b.type === 'moov');
		if (!moov) return 0;
		const kids = this.parseMp4Boxes(moovBytes, moov.payloadStart, moov.boxEnd);
		const trak = kids.find(b => b && b.type === 'trak');
		if (!trak) return 0;
		const tkhd = this.parseMp4Boxes(moovBytes, trak.payloadStart, trak.boxEnd).find(b => b && b.type === 'tkhd');
		if (!tkhd) return 0;
		const version = moovBytes[tkhd.payloadStart];
		const off = version === 1 ? (tkhd.payloadStart + 4 + 8 + 8) : (tkhd.payloadStart + 4 + 4 + 4);
		if (off + 4 > tkhd.boxEnd) return 0;
		return this.readU32(moovBytes, off);
	}

	extractTrackTimescales(moovBytes) {
		const out = new Map();
		const top = this.parseMp4Boxes(moovBytes, 0, moovBytes.byteLength);
		const moov = top.find(b => b && b.type === 'moov');
		if (!moov) return out;
		const kids = this.parseMp4Boxes(moovBytes, moov.payloadStart, moov.boxEnd);
		for (const t of kids) {
			if (!t || t.type !== 'trak') continue;
			const trakBytes = moovBytes.subarray(t.offset, t.boxEnd);
			const trackId = this.readTrackIdFromTrak(trakBytes);
			const timescale = this.readTimescaleFromTrak(trakBytes);
			if (trackId && timescale) {
				out.set(trackId, timescale);
			}
		}
		return out;
	}

	readTrackIdFromTrak(trakBytes) {
		const boxes = this.parseMp4Boxes(trakBytes, 0, trakBytes.byteLength);
		const trak = boxes.find(b => b && b.type === 'trak');
		if (!trak) return 0;
		const kids = this.parseMp4Boxes(trakBytes, trak.payloadStart, trak.boxEnd);
		const tkhd = kids.find(b => b && b.type === 'tkhd');
		if (!tkhd) return 0;
		const version = trakBytes[tkhd.payloadStart];
		const off = version === 1 ? (tkhd.payloadStart + 4 + 8 + 8) : (tkhd.payloadStart + 4 + 4 + 4);
		if (off + 4 > tkhd.boxEnd) return 0;
		return this.readU32(trakBytes, off);
	}

	readTimescaleFromTrak(trakBytes) {
		const boxes = this.parseMp4Boxes(trakBytes, 0, trakBytes.byteLength);
		const trak = boxes.find(b => b && b.type === 'trak');
		if (!trak) return 0;
		const kids = this.parseMp4Boxes(trakBytes, trak.payloadStart, trak.boxEnd);
		const mdia = kids.find(b => b && b.type === 'mdia');
		if (!mdia) return 0;
		const mdiaKids = this.parseMp4Boxes(trakBytes, mdia.payloadStart, mdia.boxEnd);
		const mdhd = mdiaKids.find(b => b && b.type === 'mdhd');
		if (!mdhd) return 0;
		return this.readMdhdTimescale(trakBytes, mdhd.payloadStart, mdhd.boxEnd);
	}

	extractTrakBoxes(moovBytes) {
		const top = this.parseMp4Boxes(moovBytes, 0, moovBytes.byteLength);
		const moov = top.find(b => b && b.type === 'moov');
		if (!moov) return [];
		const kids = this.parseMp4Boxes(moovBytes, moov.payloadStart, moov.boxEnd);
		return kids
			.filter(b => b && b.type === 'trak')
			.map(b => moovBytes.subarray(b.offset, b.boxEnd));
	}

	extractTrexBoxes(moovBytes) {
		const top = this.parseMp4Boxes(moovBytes, 0, moovBytes.byteLength);
		const moov = top.find(b => b && b.type === 'moov');
		if (!moov) return [];
		const kids = this.parseMp4Boxes(moovBytes, moov.payloadStart, moov.boxEnd);
		const mvex = kids.find(b => b && b.type === 'mvex');
		if (!mvex) return [];
		const mvexKids = this.parseMp4Boxes(moovBytes, mvex.payloadStart, mvex.boxEnd);
		return mvexKids
			.filter(b => b && b.type === 'trex')
			.map(b => moovBytes.subarray(b.offset, b.boxEnd));
	}

	patchTrakTrackId(trakBytes, newTrackId) {
		const boxes = this.parseMp4Boxes(trakBytes, 0, trakBytes.byteLength);
		const trak = boxes.find(b => b && b.type === 'trak');
		if (!trak) return;
		const kids = this.parseMp4Boxes(trakBytes, trak.payloadStart, trak.boxEnd);
		const tkhd = kids.find(b => b && b.type === 'tkhd');
		if (!tkhd) return;
		const version = trakBytes[tkhd.payloadStart];
		const off = version === 1 ? (tkhd.payloadStart + 4 + 8 + 8) : (tkhd.payloadStart + 4 + 4 + 4);
		if (off + 4 > tkhd.boxEnd) return;
		this.writeU32(trakBytes, off, newTrackId >>> 0);
	}

	patchTrexTrackId(trexBytes, newTrackId) {
		const boxes = this.parseMp4Boxes(trexBytes, 0, trexBytes.byteLength);
		const trex = boxes.find(b => b && b.type === 'trex');
		if (!trex) return;
		const off = trex.payloadStart + 4;
		if (off + 4 > trex.boxEnd) return;
		this.writeU32(trexBytes, off, newTrackId >>> 0);
	}

	mergeMoovWithAudio(videoMoovBytes, audioTrakBoxes, audioTrexBoxes) {
		const vTop = this.parseMp4Boxes(videoMoovBytes, 0, videoMoovBytes.byteLength);
		const vMoov = vTop.find(b => b && b.type === 'moov');
		if (!vMoov) {
			throw new Error('缺少 video moov');
		}
		const vKids = this.parseMp4Boxes(videoMoovBytes, vMoov.payloadStart, vMoov.boxEnd);
		const mvexIdx = vKids.findIndex(b => b && b.type === 'mvex');
		if (mvexIdx < 0) {
			throw new Error('缺少 mvex');
		}
		const mvex = vKids[mvexIdx];
		const mvexKids = this.parseMp4Boxes(videoMoovBytes, mvex.payloadStart, mvex.boxEnd);
		const mvexChildBytes = mvexKids.map(b => videoMoovBytes.subarray(b.offset, b.boxEnd));
		const newMvex = this.makeBox('mvex', this.concatUint8([...mvexChildBytes, ...audioTrexBoxes]));

		const before = vKids.slice(0, mvexIdx).map(b => videoMoovBytes.subarray(b.offset, b.boxEnd));
		const after = vKids.slice(mvexIdx + 1).map(b => videoMoovBytes.subarray(b.offset, b.boxEnd));
		const payload = this.concatUint8([...before, ...audioTrakBoxes, newMvex, ...after]);
		return this.makeBox('moov', payload);
	}

	readMoofInfo(fragmentBytes) {
		const boxes = this.parseMp4Boxes(fragmentBytes, 0, fragmentBytes.byteLength);
		const moof = boxes.find(b => b && b.type === 'moof');
		if (!moof) return null;
		const kids = this.parseMp4Boxes(fragmentBytes, moof.payloadStart, moof.boxEnd);
		const mfhd = kids.find(b => b && b.type === 'mfhd');
		const traf = kids.find(b => b && b.type === 'traf');
		if (!traf) return null;
		const trafKids = this.parseMp4Boxes(fragmentBytes, traf.payloadStart, traf.boxEnd);
		const tfhd = trafKids.find(b => b && b.type === 'tfhd');
		const tfdt = trafKids.find(b => b && b.type === 'tfdt');
		if (!tfhd || !tfdt) return null;
		const trackId = this.readU32(fragmentBytes, tfhd.payloadStart + 4);
		const version = fragmentBytes[tfdt.payloadStart];
		const tOff = tfdt.payloadStart + 4;
		const decodeTime = version === 1 ? this.readU64(fragmentBytes, tOff) : BigInt(this.readU32(fragmentBytes, tOff));
		return {
			trackId,
			decodeTime,
			mfhdPayloadStart: mfhd ? mfhd.payloadStart : 0,
			tfhdPayloadStart: tfhd.payloadStart,
			tfdtPayloadStart: tfdt.payloadStart,
			tfdtVersion: version
		};
	}

	patchMoofInPlace(fragmentBytes, { sequenceNumber, newTrackId, decodeTime }) {
		const info = this.readMoofInfo(fragmentBytes);
		if (!info) return;
		if (info.mfhdPayloadStart) {
			this.writeU32(fragmentBytes, info.mfhdPayloadStart + 4, Number(sequenceNumber) >>> 0);
		}
		this.writeU32(fragmentBytes, info.tfhdPayloadStart + 4, Number(newTrackId) >>> 0);
		const tOff = info.tfdtPayloadStart + 4;
		if (info.tfdtVersion === 1) {
			this.writeU64(fragmentBytes, tOff, BigInt(decodeTime));
		} else {
			const v = Number(decodeTime);
			this.writeU32(fragmentBytes, tOff, (v >>> 0));
		}
	}

	async downloadM3U8AsTS(key, playlistUrl, title, quality) {
		this.setJobProgress(key, 5, '拉取播放列表…');
		const signal = this.jobs.get(key)?.controller?.signal;
		const res = await fetch(playlistUrl, { method: 'GET', credentials: 'include', signal });
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const text = await res.text();

		if (/#EXT-X-KEY/i.test(text)) {
			throw new Error('不支持加密 HLS');
		}

		const picked = this.pickVariant(playlistUrl, text);
		if (picked !== playlistUrl) {
			return this.downloadM3U8AsTS(key, picked, title, quality);
		}

		const segments = this.parseSegments(text, playlistUrl);
		if (segments.length === 0) {
			throw new Error('No segments found');
		}
		const durationSec = this.sumHlsDurationSeconds(text);
		const mapUrl = this.parseExtXMapUri(text, playlistUrl);

		this.setJobProgress(key, 0, '下载分片…');

		const concurrency = 6;
		const results = new Array(segments.length);
		let completed = 0;
		const job = this.jobs.get(key);
		if (job) {
			job.hls = {
				kind: mapUrl ? 'fmp4' : 'ts',
				segments,
				downloaded: new Array(segments.length),
				contiguousCount: 0,
				mapUrl,
				initSeg: null
			};
		}

		if (mapUrl) {
			const initRes = await fetch(mapUrl, { method: 'GET', credentials: 'include', signal });
			if (!initRes.ok) {
				throw new Error(`Init HTTP ${initRes.status}`);
			}
			const initSeg = new Uint8Array(await initRes.arrayBuffer());
			if (job && job.hls) {
				job.hls.initSeg = initSeg;
			}
		}

		const worker = async (start) => {
			for (let i = start; i < segments.length; i += concurrency) {
				await this.waitIfPaused();
				const segUrl = segments[i].url;
				const r = await fetch(segUrl, { method: 'GET', credentials: 'include', signal });
				if (!r.ok) {
					throw new Error(`Segment HTTP ${r.status}`);
				}
				results[i] = new Uint8Array(await r.arrayBuffer());
				if (job && job.hls) {
					job.hls.downloaded[i] = results[i];
					let c = 0;
					while (c < job.hls.downloaded.length && job.hls.downloaded[c]) {
						c++;
					}
					job.hls.contiguousCount = c;
					this.updateTopButtons();
				}
				completed++;
				let pct = Math.floor((completed / segments.length) * 100);
				if (pct === 0 && completed > 0) {
					pct = 1;
				}
				this.setJobProgress(key, pct, '下载分片…');
			}
		};

		const workers = [];
		for (let i = 0; i < concurrency; i++) {
			workers.push(worker(i));
		}
		await Promise.all(workers);

		// Prefer producing MP4 output:
		// - If playlist uses fMP4 with EXT-X-MAP, we can stitch init + fragments directly.
		// - Otherwise (most TS-based HLS), transmux TS -> fMP4 (no re-encode) via mux.js.
		if (mapUrl) {
			this.setJobProgress(key, 98, '合并为 MP4…');
			const initSeg = (job && job.hls && job.hls.initSeg) ? job.hls.initSeg : null;
			if (!initSeg) {
				throw new Error('Missing init segment');
			}
			const patchedInit = durationSec > 0 ? this.patchMp4InitDuration(initSeg, durationSec) : initSeg;
			const blob = new Blob([patchedInit, ...results], { type: 'video/mp4' });
			this.results.set(key, { blob, filename: this.buildFilename(title, quality, 'mp4') });
		} else {
			this.setJobProgress(key, 98, '封装为 MP4…');
			const mp4Parts = this.transmuxTsToMp4(results, durationSec);
			const blob = new Blob(mp4Parts, { type: 'video/mp4' });
			this.results.set(key, { blob, filename: this.buildFilename(title, quality, 'mp4') });
		}

		this.setJobProgress(key, 100, '处理完成，可点击“保存”');
		this.enableSave(key);
	}

	ensureDownloadRow(video) {
		const empty = document.getElementById('empty');
		const list = document.getElementById('list');
		if (!list) {
			return;
		}
		if (empty) {
			empty.classList.add('hidden');
		}
		list.prepend(this.renderRow(video));

		const countEl = document.getElementById('count');
		if (countEl) {
			const n = Number(countEl.textContent || '0');
			countEl.textContent = String(n + 1);
		}
	}

	pickVariant(baseUrl, content) {
		if (!/#EXT-X-STREAM-INF/i.test(content)) {
			return baseUrl;
		}

		const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
		const variants = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.startsWith('#EXT-X-STREAM-INF:')) {
				continue;
			}
			const next = lines[i + 1] || '';
			if (!next || next.startsWith('#')) {
				continue;
			}
			const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
			const bw = bwMatch ? Number(bwMatch[1]) : 0;
			variants.push({ url: new URL(next, baseUrl).href, bw });
		}
		if (variants.length === 0) {
			return baseUrl;
		}
		variants.sort((a, b) => b.bw - a.bw);
		return variants[0].url;
	}

	parseSegments(content, baseUrl) {
		const lines = String(content || '').split('\n').map(l => l.trim());
		const segs = [];
		let lastDur = 0;
		for (const line of lines) {
			if (!line) continue;
			if (line.startsWith('#EXTINF:')) {
				const v = line.slice('#EXTINF:'.length).split(',')[0].trim();
				const n = Number.parseFloat(v);
				lastDur = Number.isFinite(n) && n > 0 ? n : 0;
				continue;
			}
			if (line.startsWith('#')) {
				continue;
			}
			segs.push({ url: new URL(line, baseUrl).href, durationSec: lastDur });
			lastDur = 0;
		}
		return segs;
	}

	parseExtXMapUri(content, baseUrl) {
		const text = String(content || '');
		const m = text.match(/#EXT-X-MAP:URI="([^"]+)"/i);
		if (!m || !m[1]) {
			return '';
		}
		try {
			return new URL(m[1], baseUrl).href;
		} catch (error) {
			return '';
		}
	}

	transmuxTsToMp4(tsSegments, durationSec) {
		const mux = globalThis.muxjs;
		if (!mux || !mux.mp4 || !mux.mp4.Transmuxer) {
			throw new Error('缺少 transmux 组件：mux.js 未加载');
		}

		// Rebase PTS/DTS onto a continuous timeline starting at 0.
		// Keeping original timestamps can produce extremely long durations when the source
		// stream has discontinuities or large initial PTS values.
		const transmuxer = new mux.mp4.Transmuxer({ keepOriginalTimestamps: false });
		const parts = [];
		let initAdded = false;

		transmuxer.on('data', (segment) => {
			if (!segment) {
				return;
			}
			if (!initAdded && segment.initSegment && segment.initSegment.byteLength) {
				parts.push(segment.initSegment);
				initAdded = true;
			}
			if (segment.data && segment.data.byteLength) {
				parts.push(segment.data);
			}
		});

		for (const seg of tsSegments) {
			if (!seg || !seg.byteLength) {
				continue;
			}
			transmuxer.push(seg);
		}
		transmuxer.flush();

		if (!initAdded) {
			throw new Error('无法封装为 MP4（缺少 init segment）');
		}

		try {
			transmuxer.dispose();
		} catch (error) {
			// Ignore
		}

		if (durationSec > 0 && parts.length > 0) {
			parts[0] = this.patchMp4InitDuration(parts[0], durationSec);
		}
		return parts;
	}

	sumHlsDurationSeconds(content) {
		const lines = String(content || '').split('\n');
		let total = 0;
		for (const line of lines) {
			if (!line) continue;
			if (!line.startsWith('#EXTINF:')) continue;
			const v = line.slice('#EXTINF:'.length).split(',')[0].trim();
			const n = Number.parseFloat(v);
			if (Number.isFinite(n) && n > 0) {
				total += n;
			}
		}
		// Round to milliseconds precision to keep durations stable
		return Math.max(0, Math.round(total * 1000) / 1000);
	}

	patchMp4InitDuration(initSegment, durationSec) {
		try {
			const bytes = initSegment instanceof Uint8Array ? initSegment : new Uint8Array(initSegment);
			const out = new Uint8Array(bytes.byteLength);
			out.set(bytes);

			const moov = this.findMp4Box(out, 0, out.byteLength, 'moov');
			if (!moov) {
				return bytes;
			}

			const mvhd = this.findMp4Box(out, moov.start, moov.end, 'mvhd');
			if (!mvhd) {
				return bytes;
			}

			const movieTimescale = this.readMvhdTimescale(out, mvhd.start, mvhd.end);
			if (!movieTimescale) {
				return bytes;
			}

			this.writeMvhdDuration(out, mvhd.start, mvhd.end, movieTimescale, durationSec);

			// Patch tkhd (movie timescale)
			this.walkMp4Boxes(out, moov.start, moov.end, (type, start, end) => {
				if (type === 'tkhd') {
					this.writeTkhdDuration(out, start, end, movieTimescale, durationSec);
				}
				if (type === 'mdhd') {
					const ts = this.readMdhdTimescale(out, start, end);
					if (ts) {
						this.writeMdhdDuration(out, start, end, ts, durationSec);
					}
				}
			});

			return out;
		} catch (error) {
			return initSegment;
		}
	}

	findMp4Box(bytes, start, end, targetType) {
		let offset = start;
		while (offset + 8 <= end) {
			let size = this.readU32(bytes, offset);
			const type = this.readType(bytes, offset + 4);
			let header = 8;
			if (size === 1) {
				if (offset + 16 > end) return null;
				size = Number(this.readU64(bytes, offset + 8));
				header = 16;
			} else if (size === 0) {
				size = end - offset;
			}
			if (size < header || offset + size > end) {
				return null;
			}
			const boxStart = offset + header;
			const boxEnd = offset + size;
			if (type === targetType) {
				return { start: boxStart, end: boxEnd };
			}
			// moov children live inside boxStart..boxEnd
			if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
				const found = this.findMp4Box(bytes, boxStart, boxEnd, targetType);
				if (found) return found;
			}
			offset += size;
		}
		return null;
	}

	walkMp4Boxes(bytes, start, end, onBox) {
		let offset = start;
		while (offset + 8 <= end) {
			let size = this.readU32(bytes, offset);
			const type = this.readType(bytes, offset + 4);
			let header = 8;
			if (size === 1) {
				if (offset + 16 > end) return;
				size = Number(this.readU64(bytes, offset + 8));
				header = 16;
			} else if (size === 0) {
				size = end - offset;
			}
			if (size < header || offset + size > end) {
				return;
			}
			const boxStart = offset + header;
			const boxEnd = offset + size;
			onBox(type, boxStart, boxEnd);
			if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
				this.walkMp4Boxes(bytes, boxStart, boxEnd, onBox);
			}
			offset += size;
		}
	}

	readMvhdTimescale(bytes, start, end) {
		// mvhd is a FullBox: version(1) flags(3) then fields
		if (start + 4 > end) return 0;
		const version = bytes[start];
		if (version === 1) {
			// creation(8) mod(8) timescale(4) duration(8)
			if (start + 4 + 8 + 8 + 4 > end) return 0;
			return this.readU32(bytes, start + 4 + 8 + 8);
		}
		// version 0: creation(4) mod(4) timescale(4) duration(4)
		if (start + 4 + 4 + 4 + 4 > end) return 0;
		return this.readU32(bytes, start + 4 + 4 + 4);
	}

	readMdhdTimescale(bytes, start, end) {
		if (start + 4 > end) return 0;
		const version = bytes[start];
		if (version === 1) {
			// creation(8) mod(8) timescale(4) duration(8)
			if (start + 4 + 8 + 8 + 4 > end) return 0;
			return this.readU32(bytes, start + 4 + 8 + 8);
		}
		if (start + 4 + 4 + 4 + 4 > end) return 0;
		return this.readU32(bytes, start + 4 + 4 + 4);
	}

	writeMvhdDuration(bytes, start, end, timescale, durationSec) {
		const version = bytes[start];
		const dur = Math.max(0, Math.round(durationSec * timescale));
		if (version === 1) {
			// duration 8 bytes at: start + 4 + 8 + 8 + 4
			const off = start + 4 + 8 + 8 + 4;
			if (off + 8 <= end) this.writeU64(bytes, off, BigInt(dur));
			return;
		}
		const off = start + 4 + 4 + 4 + 4;
		if (off + 4 <= end) this.writeU32(bytes, off, dur >>> 0);
	}

	writeTkhdDuration(bytes, start, end, movieTimescale, durationSec) {
		// tkhd duration uses movie timescale; tkhd is FullBox
		const version = bytes[start];
		const dur = Math.max(0, Math.round(durationSec * movieTimescale));
		if (version === 1) {
			// creation(8) mod(8) trackId(4) reserved(4) duration(8)
			const off = start + 4 + 8 + 8 + 4 + 4;
			if (off + 8 <= end) this.writeU64(bytes, off, BigInt(dur));
			return;
		}
		// creation(4) mod(4) trackId(4) reserved(4) duration(4)
		const off = start + 4 + 4 + 4 + 4 + 4;
		if (off + 4 <= end) this.writeU32(bytes, off, dur >>> 0);
	}

	writeMdhdDuration(bytes, start, end, timescale, durationSec) {
		const version = bytes[start];
		const dur = Math.max(0, Math.round(durationSec * timescale));
		if (version === 1) {
			const off = start + 4 + 8 + 8 + 4;
			if (off + 8 <= end) this.writeU64(bytes, off, BigInt(dur));
			return;
		}
		const off = start + 4 + 4 + 4 + 4;
		if (off + 4 <= end) this.writeU32(bytes, off, dur >>> 0);
	}

	readU32(bytes, offset) {
		return ((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
	}

	readU64(bytes, offset) {
		const hi = BigInt(this.readU32(bytes, offset));
		const lo = BigInt(this.readU32(bytes, offset + 4));
		return (hi << 32n) | lo;
	}

	writeU32(bytes, offset, value) {
		bytes[offset] = (value >>> 24) & 0xff;
		bytes[offset + 1] = (value >>> 16) & 0xff;
		bytes[offset + 2] = (value >>> 8) & 0xff;
		bytes[offset + 3] = value & 0xff;
	}

	writeU64(bytes, offset, value) {
		const hi = Number((value >> 32n) & 0xffffffffn);
		const lo = Number(value & 0xffffffffn);
		this.writeU32(bytes, offset, hi >>> 0);
		this.writeU32(bytes, offset + 4, lo >>> 0);
	}

	readType(bytes, offset) {
		return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
	}

	enableSave(key) {
		const job = this.jobs.get(key);
		if (job) {
			job.status = 'idle';
			job.controller = null;
		}
		if (this.activeJobKey === key) {
			this.updateToolbarState();
		}
		this.updateTopButtons();
	}

	saveResult(key) {
		const r = this.results.get(key);
		if (!r) {
			return;
		}
		this.downloadViaBrowser(r.blob, r.filename);
	}

	saveCurrentPart(video) {
		if (!video || !video.key) {
			return;
		}
		const key = video.key;
		if (this.results.has(key)) {
			this.saveResult(key);
			return;
		}

		const job = this.jobs.get(key);
		if (!job || !job.hls || !job.hls.downloaded || !job.hls.segments) {
			return;
		}

		const count = Number(job.hls.contiguousCount || 0);
		if (count <= 0) {
			return;
		}

		let dur = 0;
		for (let i = 0; i < count; i++) {
			const d = job.hls.segments[i] && Number(job.hls.segments[i].durationSec || 0);
			if (Number.isFinite(d) && d > 0) {
				dur += d;
			}
		}

		const partTitle = `${video.title || 'video'}_part`;
		const q = video.selectedQuality || '';

		if (job.hls.kind === 'fmp4') {
			if (!job.hls.initSeg) {
				return;
			}
			const fragments = job.hls.downloaded.slice(0, count).filter(Boolean);
			const patchedInit = dur > 0 ? this.patchMp4InitDuration(job.hls.initSeg, dur) : job.hls.initSeg;
			const blob = new Blob([patchedInit, ...fragments], { type: 'video/mp4' });
			this.downloadViaBrowser(blob, this.buildFilename(partTitle, q, 'mp4'));
			return;
		}

		const tsSegs = job.hls.downloaded.slice(0, count).filter(Boolean);
		const mp4Parts = this.transmuxTsToMp4(tsSegs, dur);
		const blob = new Blob(mp4Parts, { type: 'video/mp4' });
		this.downloadViaBrowser(blob, this.buildFilename(partTitle, q, 'mp4'));
	}

	downloadViaBrowser(blob, filename) {
		const blobUrl = URL.createObjectURL(blob);
		chrome.downloads.download({
			url: blobUrl,
			filename: filename,
			saveAs: false,
			conflictAction: 'uniquify'
		}, () => {
			setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
		});
	}

	ensureRecordingRow(key, title, quality) {
		const list = document.getElementById('list');
		if (!list) {
			return;
		}
		if (this.jobs.has(key)) {
			return;
		}
		const v = {
			src: key,
			title: title || this.pageTitle || '录制结果',
			quality: quality || 'unknown',
			type: 'recording'
		};
		list.prepend(this.renderRow(v));
		document.getElementById('count').textContent = String(Number(document.getElementById('count').textContent || '0') + 1);
	}

	buildFilename(title, quality, ext) {
		const safe = String(title || 'video')
			.replace(/[<>:"/\\|?*]/g, '_')
			.replace(/\s+/g, '_')
			.substring(0, 90);
		const q = quality ? `_${quality}` : '';
		const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
		return `videos/${safe}${q}_${ts}.${ext}`;
	}

	guessExt(url, mime) {
		const u = url.toLowerCase();
		if (u.includes('.mp4')) return 'mp4';
		if (u.includes('.webm')) return 'webm';
		if (u.includes('.mkv')) return 'mkv';
		if (u.includes('.flv')) return 'flv';
		if (mime && mime.includes('webm')) return 'webm';
		if (mime && mime.includes('mp4')) return 'mp4';
		return 'bin';
	}

	formatBytes(bytes) {
		const b = Number(bytes || 0);
		if (!b) return '';
		if (b < 1024) return `${b} B`;
		if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
		if (b < 1024 * 1024 * 1024) return `${Math.round(b / 1024 / 1024)} MB`;
		return `${Math.round(b / 1024 / 1024 / 1024)} GB`;
	}
}

document.addEventListener('DOMContentLoaded', () => {
	new ManagerPage();
});


