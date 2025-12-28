(function (g) {
	'use strict';

	function isScriptableUrl(url) {
		try {
			const u = new URL(url);
			if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) {
				return false;
			}
			if (u.hostname === 'chromewebstore.google.com') {
				return false;
			}
			return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:';
		} catch (error) {
			return false;
		}
	}

	function isBlobOrDataUrl(url) {
		return typeof url === 'string' && (url.startsWith('blob:') || url.startsWith('data:'));
	}

	function findAlternativeDownloadUrl(video, allVideos) {
		const groupKey = (video && video.title) ? video.title : 'Unknown Video';

		if (video && Array.isArray(video.sources)) {
			const fromSources = video.sources.find(source =>
				source && source.src && !isBlobOrDataUrl(source.src)
			);
			if (fromSources) {
				return fromSources.src;
			}
		}

		const list = Array.isArray(allVideos) ? allVideos : [];
		for (const v of list) {
			if ((v && (v.title || 'Unknown Video')) !== groupKey) {
				continue;
			}

			if (v && v.src && !isBlobOrDataUrl(v.src)) {
				return v.src;
			}

			if (v && Array.isArray(v.sources)) {
				const fromSources = v.sources.find(source =>
					source && source.src && !isBlobOrDataUrl(source.src)
				);
				if (fromSources) {
					return fromSources.src;
				}
			}
		}

		return null;
	}

	g.VDHUtils = {
		isScriptableUrl,
		isBlobOrDataUrl,
		findAlternativeDownloadUrl
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);


