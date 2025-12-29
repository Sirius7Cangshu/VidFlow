// Clean generated artifacts for the extension package.
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const iconsDir = path.join(projectRoot, 'icons');
const zipFile = path.join(projectRoot, 'video-download-helper.zip');

if (fs.existsSync(iconsDir)) {
	const entries = fs.readdirSync(iconsDir);
	for (const name of entries) {
		if (!name.startsWith('icon') || !name.endsWith('.png')) {
			continue;
		}
		fs.unlinkSync(path.join(iconsDir, name));
	}
}

if (fs.existsSync(zipFile)) {
	fs.unlinkSync(zipFile);
}


