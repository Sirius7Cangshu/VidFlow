// Video Download Helper - Injected Script
// Injected into web pages to perform deep video detection

(function () {
	'use strict';

	if (window.__VDHInjected) {
		return;
	}
	window.__VDHInjected = true;

	console.log('Video Download Helper injected script loaded');

	// Deep video detection functions
	const VideoInjector = {
		init() {
			this.interceptMediaRequests();
			this.monitorMediaElements();
			this.hookIntoVideoPlayers();
		},

		interceptMediaRequests() {
			// Hook into XMLHttpRequest
			const originalXHROpen = XMLHttpRequest.prototype.open;
			const originalXHRSend = XMLHttpRequest.prototype.send;

			XMLHttpRequest.prototype.open = function (method, url, ...args) {
				this._url = url;
				this._method = method;
				return originalXHROpen.call(this, method, url, ...args);
			};

			XMLHttpRequest.prototype.send = function (data) {
				if (this._url && VideoInjector.isVideoRequest(this._url)) {
					console.log('Video XHR detected:', this._url);
					VideoInjector.reportVideoFound(this._url, 'xhr');
				}
				return originalXHRSend.call(this, data);
			};

			// Hook into Fetch API
			const originalFetch = window.fetch;
			let hasLoggedInsecureAdspowerFetch = false;
			window.fetch = async function (...args) {
				const [resource] = args;
				let url = '';
				try {
					if (typeof resource === 'string') {
						url = resource;
					} else if (resource && typeof resource === 'object') {
						// Request / URL / custom RequestInfo
						if (typeof resource.url === 'string') {
							url = resource.url;
						} else if (typeof resource.href === 'string') {
							url = resource.href;
						} else {
							url = String(resource);
						}
					} else {
						url = String(resource);
					}
				} catch (e) {
					// ignore
				}

				// Prevent noisy Mixed Content errors caused by insecure local adspower calls on HTTPS pages.
				// We short-circuit the request (no network call) so the browser won't emit Mixed Content warnings.
				const normalizedUrl = typeof url === 'string' ? url.trim() : '';
				const normalizedUrlLower = normalizedUrl.toLowerCase();
				const isInsecureAdspowerFetch = !!normalizedUrlLower &&
					normalizedUrlLower.startsWith('http://') &&
					normalizedUrlLower.includes('adspower.net');
				if (isInsecureAdspowerFetch) {
					if (!hasLoggedInsecureAdspowerFetch) {
						hasLoggedInsecureAdspowerFetch = true;
						console.groupCollapsed('VidFlow: Blocked insecure adspower fetch (Mixed Content)', normalizedUrl);
						console.trace('caller');
						console.groupEnd();
					}
					// Return a safe JSON response to avoid follow-up `.json()` parse errors in the caller.
					return new Response('{}', {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				if (VideoInjector.isVideoRequest(url)) {
					console.log('Video fetch detected:', url);
					VideoInjector.reportVideoFound(url, 'fetch');
				}

				try {
					return await originalFetch.apply(this, args);
				} catch (err) {
					// Fallback: if the request is adspower-related but we failed to match earlier (unexpected shapes),
					// still swallow the error to prevent Uncaught (in promise) noise.
					if (normalizedUrlLower.includes('adspower.net')) {
						if (!hasLoggedInsecureAdspowerFetch) {
							hasLoggedInsecureAdspowerFetch = true;
							console.groupCollapsed('VidFlow: Suppressed adspower fetch failure', normalizedUrl || url);
							console.trace('caller');
							console.groupEnd();
						}
						return new Response('{}', {
							status: 200,
							headers: { 'Content-Type': 'application/json' }
						});
					}
					throw err;
				}
			};
		},

		monitorMediaElements() {
			// Create a MutationObserver to watch for new media elements
			const observer = new MutationObserver((mutations) => {
				mutations.forEach((mutation) => {
					mutation.addedNodes.forEach((node) => {
						if (node.nodeType === 1) {
							this.checkNodeForMedia(node);
						}
					});
				});
			});

			observer.observe(document.body, {
				childList: true,
				subtree: true
			});

			// Check existing media elements
			this.checkExistingMedia();
		},

		checkNodeForMedia(node) {
			// Check if the node itself is a media element
			if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
				this.analyzeMediaElement(node);
			}

			// Check for media elements within the node
			const mediaElements = node.querySelectorAll && node.querySelectorAll('video, audio');
			if (mediaElements) {
				mediaElements.forEach(element => this.analyzeMediaElement(element));
			}

			// Check for video containers or players
			this.checkForVideoPlayers(node);
		},

		checkExistingMedia() {
			const mediaElements = document.querySelectorAll('video, audio');
			mediaElements.forEach(element => this.analyzeMediaElement(element));
		},

		analyzeMediaElement(element) {
			if (element.src) {
				console.log('Media element found:', element.src);
				this.reportVideoFound(element.src, 'element');
			}

			// Check for source elements
			const sources = element.querySelectorAll('source');
			sources.forEach(source => {
				if (source.src) {
					console.log('Media source found:', source.src);
					this.reportVideoFound(source.src, 'source');
				}
			});

			// Monitor for dynamic source changes
			this.monitorElementChanges(element);
		},

		monitorElementChanges(element) {
			// Listen for loadstart events which indicate new media loading
			element.addEventListener('loadstart', () => {
				if (element.src || element.currentSrc) {
					console.log('Media source changed:', element.currentSrc || element.src);
					this.reportVideoFound(element.currentSrc || element.src, 'dynamic');
				}
			});

			// Monitor attribute changes
			const observer = new MutationObserver((mutations) => {
				mutations.forEach((mutation) => {
					if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
						const newSrc = element.getAttribute('src');
						if (newSrc) {
							console.log('Media src attribute changed:', newSrc);
							this.reportVideoFound(newSrc, 'attribute');
						}
					}
				});
			});

			observer.observe(element, {
				attributes: true,
				attributeFilter: ['src']
			});
		},

		checkForVideoPlayers(node) {
			if (!node.className) return;

			const className = node.className.toString().toLowerCase();
			const videoPlayerIndicators = [
				'video-player',
				'media-player',
				'jwplayer',
				'videojs',
				'plyr',
				'flowplayer',
				'brightcove',
				'wistia',
				'vimeo-player'
			];

			const isVideoPlayer = videoPlayerIndicators.some(indicator =>
				className.includes(indicator)
			);

			if (isVideoPlayer) {
				console.log('Video player container detected:', node);
				this.analyzeVideoPlayer(node);
			}
		},

		analyzeVideoPlayer(container) {
			// Try to find video elements within the player
			const videoElements = container.querySelectorAll('video');
			videoElements.forEach(video => this.analyzeMediaElement(video));

			// Look for data attributes that might contain video URLs
			const dataAttributes = Array.from(container.attributes).filter(attr =>
				attr.name.startsWith('data-') &&
				(attr.value.includes('.mp4') || attr.value.includes('.webm') || attr.value.includes('video'))
			);

			dataAttributes.forEach(attr => {
				console.log('Video URL in data attribute:', attr.value);
				this.reportVideoFound(attr.value, 'data-attribute');
			});
		},

		hookIntoVideoPlayers() {
			// Hook into popular video player APIs
			this.hookJWPlayer();
			this.hookVideoJS();
			this.hookPlyr();
		},

		hookJWPlayer() {
			if (window.jwplayer) {
				const originalSetup = window.jwplayer.prototype.setup;
				window.jwplayer.prototype.setup = function (config) {
					if (config.file) {
						console.log('JW Player video detected:', config.file);
						VideoInjector.reportVideoFound(config.file, 'jwplayer');
					}
					if (config.playlist) {
						config.playlist.forEach(item => {
							if (item.file) {
								console.log('JW Player playlist item:', item.file);
								VideoInjector.reportVideoFound(item.file, 'jwplayer-playlist');
							}
						});
					}
					return originalSetup.call(this, config);
				};
			}
		},

		hookVideoJS() {
			if (window.videojs) {
				const originalSrc = window.videojs.prototype.src;
				window.videojs.prototype.src = function (source) {
					if (source && typeof source === 'string') {
						console.log('Video.js source detected:', source);
						VideoInjector.reportVideoFound(source, 'videojs');
					} else if (source && source.src) {
						console.log('Video.js source object detected:', source.src);
						VideoInjector.reportVideoFound(source.src, 'videojs');
					}
					return originalSrc.call(this, source);
				};
			}
		},

		hookPlyr() {
			if (window.Plyr) {
				const originalSetup = window.Plyr.setup;
				window.Plyr.setup = function (targets, options) {
					console.log('Plyr player setup detected');
					const players = originalSetup.call(this, targets, options);

					players.forEach(player => {
						if (player.source && player.source.sources) {
							player.source.sources.forEach(source => {
								if (source.src) {
									console.log('Plyr source detected:', source.src);
									VideoInjector.reportVideoFound(source.src, 'plyr');
								}
							});
						}
					});

					return players;
				};
			}
		},

		isVideoRequest(url) {
			if (!url || typeof url !== 'string') return false;

			const videoExtensions = /\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv|m4v|m4s|ts)(\?.*)?$/i;
			const streamingFormats = /\.(m3u8|mpd)(\?.*)?$/i;
			const videoMimeTypes = ['video/', 'application/vnd.apple.mpegurl', 'application/dash+xml'];

			return videoExtensions.test(url) ||
				streamingFormats.test(url) ||
				videoMimeTypes.some(type => url.includes(type));
		},

		reportVideoFound(url, source) {
			// Send message to content script
			window.postMessage({
				type: 'VIDEO_DETECTED',
				data: {
					url: url,
					source: source,
					timestamp: Date.now(),
					title: document.title,
					domain: window.location.hostname
				}
			}, '*');
		}
	};

	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => VideoInjector.init());
	} else {
		VideoInjector.init();
	}

	// Listen for messages from content script
	window.addEventListener('message', (event) => {
		if (event.source !== window) return;

		if (event.data.type === 'SCAN_FOR_VIDEOS') {
			VideoInjector.checkExistingMedia();
		}
	});

})();
