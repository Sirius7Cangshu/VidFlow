// Create a distributable zip package for the Chrome/Edge extension.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const outFile = path.join(projectRoot, 'video-download-helper.zip');

if (fs.existsSync(outFile)) {
	fs.unlinkSync(outFile);
}

function run(cmd, args) {
	const res = spawnSync(cmd, args, { cwd: projectRoot, stdio: 'inherit' });
	const code = typeof res.status === 'number' ? res.status : 1;
	if (code !== 0) {
		process.exit(code);
	}
}

// Keep exclusions aligned with the old zip command.
const excludes = [
	'.git',
	'.git*',
	'node_modules',
	'node_modules/*',
	'*.log',
	'package*.json',
	'generate-icons.js',
	'video-download-helper.zip'
];

if (process.platform === 'win32') {
	// Windows: use the built-in bsdtar (tar.exe) to create a zip archive.
	const args = ['-a', '-cf', outFile];
	for (const p of excludes) {
		args.push('--exclude', p);
	}
	args.push('.');
	run('tar', args);
	process.exit(0);
}

// macOS/Linux: use the common `zip` CLI.
run('zip', ['-r', outFile, '.', '-x', ...excludes]);


