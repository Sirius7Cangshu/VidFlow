const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(canvas, size) {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, size, size);

	const s = size / 128;

	// Background gradient
	const bgGrad = ctx.createLinearGradient(0, 0, size, size);
	bgGrad.addColorStop(0, '#667EEA');
	bgGrad.addColorStop(0.5, '#764BA2');
	bgGrad.addColorStop(1, '#F093FB');

	// Rounded rectangle
	const r = 26 * s;
	const x = 8 * s, y = 8 * s, w = 112 * s, h = 112 * s;
	
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();

	ctx.fillStyle = bgGrad;
	ctx.fill();

	// Glass shine
	const shineGrad = ctx.createLinearGradient(0, y, 0, y + h / 2);
	shineGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
	shineGrad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
	shineGrad.addColorStop(1, 'rgba(255,255,255,0)');
	
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h / 2);
	ctx.lineTo(x, y + h / 2);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
	ctx.fillStyle = shineGrad;
	ctx.fill();

	// Play button circle background
	ctx.beginPath();
	ctx.arc(64 * s, 52 * s, 28 * s, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255,255,255,0.2)';
	ctx.fill();

	// Play button circle
	ctx.beginPath();
	ctx.arc(64 * s, 52 * s, 24 * s, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255,255,255,0.95)';
	ctx.fill();

	// Play triangle with gradient
	const playGrad = ctx.createLinearGradient(58 * s, 40 * s, 76 * s, 64 * s);
	playGrad.addColorStop(0, '#667EEA');
	playGrad.addColorStop(0.5, '#764BA2');
	playGrad.addColorStop(1, '#F093FB');
	
	ctx.fillStyle = playGrad;
	ctx.beginPath();
	ctx.moveTo(58 * s, 40 * s);
	ctx.lineTo(58 * s, 64 * s);
	ctx.lineTo(76 * s, 52 * s);
	ctx.closePath();
	ctx.fill();

	// Download elements
	ctx.fillStyle = 'rgba(255,255,255,0.95)';

	// Arrow stem
	roundRect(ctx, 60 * s, 84 * s, 8 * s, 16 * s, 2 * s);
	ctx.fill();

	// Arrow head
	ctx.beginPath();
	ctx.moveTo(64 * s, 108 * s);
	ctx.lineTo(52 * s, 96 * s);
	ctx.lineTo(56 * s, 92 * s);
	ctx.lineTo(64 * s, 100 * s);
	ctx.lineTo(72 * s, 92 * s);
	ctx.lineTo(76 * s, 96 * s);
	ctx.closePath();
	ctx.fill();

	// Base line
	roundRect(ctx, 48 * s, 104 * s, 32 * s, 4 * s, 2 * s);
	ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

const sizes = [16, 32, 48, 128];

sizes.forEach(size => {
	const canvas = createCanvas(size, size);
	drawIcon(canvas, size);
	
	const buffer = canvas.toBuffer('image/png');
	const filename = path.join(__dirname, 'icons', `icon${size}.png`);
	fs.writeFileSync(filename, buffer);
	console.log(`Generated ${filename} (${buffer.length} bytes)`);
});

console.log('All icons generated!');
