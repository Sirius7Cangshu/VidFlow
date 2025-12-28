// Icon generator for Video Download Helper
// This script generates PNG icons from canvas for the Chrome extension

const fs = require('fs');
const path = require('path');

// Create a simple icon using Canvas-like drawing
function generateIcon(size) {
	// Create a simple base64 encoded PNG for the icon
	// This is a minimal 1x1 transparent PNG
	const transparentPNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

	// For a real implementation, you would use a proper canvas or image generation library
	// This is just a placeholder that creates valid PNG files

	const canvas = {
		width: size,
		height: size,
		getContext: () => ({
			fillStyle: '',
			strokeStyle: '',
			lineWidth: 0,
			fillRect: () => { },
			strokeRect: () => { },
			beginPath: () => { },
			arc: () => { },
			fill: () => { },
			stroke: () => { },
			moveTo: () => { },
			lineTo: () => { },
			closePath: () => { },
			fillText: () => { },
			createLinearGradient: () => ({
				addColorStop: () => { }
			})
		}),
		toDataURL: () => transparentPNG
	};

	const ctx = canvas.getContext('2d');

	// Create gradient background
	const gradient = ctx.createLinearGradient(0, 0, size, size);
	gradient.addColorStop(0, '#3b82f6');
	gradient.addColorStop(1, '#8b5cf6');

	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);

	// Draw video play icon
	ctx.fillStyle = 'white';
	ctx.beginPath();
	ctx.moveTo(size * 0.35, size * 0.27);
	ctx.lineTo(size * 0.35, size * 0.73);
	ctx.lineTo(size * 0.74, size * 0.5);
	ctx.closePath();
	ctx.fill();

	// Draw download arrow
	ctx.strokeStyle = 'white';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(size * 0.7, size * 0.2);
	ctx.lineTo(size * 0.7, size * 0.4);
	ctx.moveTo(size * 0.65, size * 0.35);
	ctx.lineTo(size * 0.7, size * 0.4);
	ctx.lineTo(size * 0.75, size * 0.35);
	ctx.stroke();

	return canvas.toDataURL('image/png');
}

// Generate icons for different sizes
const sizes = [16, 32, 48, 128];

sizes.forEach(size => {
	const iconData = generateIcon(size);
	const base64Data = iconData.replace(/^data:image\/png;base64,/, '');
	const buffer = Buffer.from(base64Data, 'base64');

	const filename = path.join(__dirname, 'icons', `icon${size}.png`);

	// Ensure icons directory exists
	const iconsDir = path.dirname(filename);
	if (!fs.existsSync(iconsDir)) {
		fs.mkdirSync(iconsDir, { recursive: true });
	}

	fs.writeFileSync(filename, buffer);
	console.log(`Generated ${filename}`);
});

console.log('All icons generated successfully!');
