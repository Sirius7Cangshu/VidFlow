const assert = require('assert');

require('../js/utils.js');

const utils = globalThis.VDHUtils;

function run(name, fn) {
	try {
		fn();
		process.stdout.write(`PASS ${name}\n`);
	} catch (error) {
		process.stderr.write(`FAIL ${name}\n`);
		process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	}
}

run('isScriptableUrl allows http/https/file', () => {
	assert.strictEqual(utils.isScriptableUrl('https://example.com/path'), true);
	assert.strictEqual(utils.isScriptableUrl('http://example.com/'), true);
	assert.strictEqual(utils.isScriptableUrl('file:///Users/me/video.html'), true);
});

run('isScriptableUrl blocks chrome/about and webstore', () => {
	assert.strictEqual(utils.isScriptableUrl('chrome://extensions/'), false);
	assert.strictEqual(utils.isScriptableUrl('about:blank'), false);
	assert.strictEqual(utils.isScriptableUrl('https://chromewebstore.google.com/detail/xxx'), false);
	assert.strictEqual(utils.isScriptableUrl('https://chrome.google.com/webstore/detail/xxx'), false);
});

run('isBlobOrDataUrl works', () => {
	assert.strictEqual(utils.isBlobOrDataUrl('blob:https://example.com/123'), true);
	assert.strictEqual(utils.isBlobOrDataUrl('data:video/mp4;base64,AAA'), true);
	assert.strictEqual(utils.isBlobOrDataUrl('https://example.com/a.mp4'), false);
});

run('findAlternativeDownloadUrl prefers non-blob sources on the clicked video', () => {
	const clicked = {
		title: 'Video A',
		src: 'blob:https://example.com/1',
		sources: [
			{ src: 'blob:https://example.com/2' },
			{ src: 'https://cdn.example.com/video.mp4' }
		]
	};
	assert.strictEqual(utils.findAlternativeDownloadUrl(clicked, []), 'https://cdn.example.com/video.mp4');
});

run('findAlternativeDownloadUrl falls back to same-title videos', () => {
	const clicked = { title: 'Video A', src: 'blob:https://example.com/1' };
	const all = [
		{ title: 'Video B', src: 'https://cdn.example.com/other.mp4' },
		{ title: 'Video A', src: 'https://cdn.example.com/video.mp4' }
	];
	assert.strictEqual(utils.findAlternativeDownloadUrl(clicked, all), 'https://cdn.example.com/video.mp4');
});

run('findAlternativeDownloadUrl returns null when no alternative exists', () => {
	const clicked = { title: 'Video A', src: 'blob:https://example.com/1' };
	const all = [{ title: 'Video A', src: 'blob:https://example.com/2' }];
	assert.strictEqual(utils.findAlternativeDownloadUrl(clicked, all), null);
});

if (process.exitCode) {
	process.exit(1);
}


