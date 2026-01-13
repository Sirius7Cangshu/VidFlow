const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(canvas, size) {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, size, size);

	const s = size / 128;

	// Sophisticated deep teal gradient
	const dropGrad = ctx.createLinearGradient(0, 0, size, size);
	dropGrad.addColorStop(0, '#2D9596');
	dropGrad.addColorStop(0.35, '#1E6F72');
	dropGrad.addColorStop(0.7, '#145A5E');
	dropGrad.addColorStop(1, '#0D3D3F');

	// Draw water drop shape with shadow
	ctx.shadowColor = 'rgba(13, 61, 63, 0.3)';
	ctx.shadowBlur = 5 * s;
	ctx.shadowOffsetY = 3 * s;
	
	drawWaterDrop(ctx, s);
	ctx.fillStyle = dropGrad;
	ctx.fill();
	
	// Reset shadow
	ctx.shadowColor = 'transparent';
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;

	// Subtle inner depth overlay
	const innerDepth = ctx.createRadialGradient(51 * s, 45 * s, 0, 64 * s, 64 * s, 83 * s);
	innerDepth.addColorStop(0, 'rgba(58, 171, 172, 0.25)');
	innerDepth.addColorStop(1, 'rgba(13, 61, 63, 0.3)');
	
	drawWaterDrop(ctx, s);
	ctx.fillStyle = innerDepth;
	ctx.fill();

	// Glass highlight
	const highlightGrad = ctx.createLinearGradient(26 * s, 0, 102 * s, size);
	highlightGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
	highlightGrad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
	highlightGrad.addColorStop(1, 'rgba(255,255,255,0)');
	
	ctx.beginPath();
	ctx.moveTo(64 * s, 14 * s);
	ctx.bezierCurveTo(64 * s, 14 * s, 32 * s, 48 * s, 28 * s, 72 * s);
	ctx.bezierCurveTo(28 * s, 72 * s, 38 * s, 42 * s, 64 * s, 18 * s);
	ctx.closePath();
	ctx.fillStyle = highlightGrad;
	ctx.fill();

	// Small highlight accent
	ctx.save();
	ctx.translate(38 * s, 50 * s);
	ctx.rotate(-30 * Math.PI / 180);
	ctx.beginPath();
	ctx.ellipse(0, 0, 6 * s, 4 * s, 0, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255,255,255,0.25)';
	ctx.fill();
	ctx.restore();

	// Play triangle - directly on drop, no background circle
	ctx.fillStyle = 'rgba(255,255,255,0.95)';
	ctx.beginPath();
	ctx.moveTo(52 * s, 58 * s);
	ctx.lineTo(52 * s, 98 * s);
	ctx.lineTo(84 * s, 78 * s);
	ctx.closePath();
	ctx.fill();
}

function drawWaterDrop(ctx, s) {
	ctx.beginPath();
	ctx.moveTo(64 * s, 8 * s);
	// Left curve
	ctx.bezierCurveTo(
		64 * s, 8 * s,
		20 * s, 52 * s,
		20 * s, 80 * s
	);
	// Bottom left curve
	ctx.bezierCurveTo(
		20 * s, 104 * s,
		40 * s, 120 * s,
		64 * s, 120 * s
	);
	// Bottom right curve
	ctx.bezierCurveTo(
		88 * s, 120 * s,
		108 * s, 104 * s,
		108 * s, 80 * s
	);
	// Right curve back to top
	ctx.bezierCurveTo(
		108 * s, 52 * s,
		64 * s, 8 * s,
		64 * s, 8 * s
	);
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
