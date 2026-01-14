const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

/**
 * VidFlow Icon Generator - Size-Adaptive Edition
 * 
 * Design Philosophy:
 * - Large sizes (128px): Full detail with waves, gloss, shadows
 * - Medium sizes (48px): Moderate detail, subtle waves
 * - Small sizes (32px): Simplified, gloss only
 * - Tiny sizes (16px): Minimal, just core elements
 * 
 * Based on ui-ux-pro-max best practices:
 * - Squircle shape (Apple-style continuous curvature)
 * - Deep Blue (#1D4ED8) → Electric Blue (#3B82F6) → Cyan (#06B6D4)
 * - Play symbol must remain recognizable at all sizes
 */

function drawIcon(canvas, size) {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, size, size);

	// Enable high-quality rendering
	ctx.imageSmoothingEnabled = true;
	if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';

	const s = size / 128;

	// Size-adaptive parameters
	const isTiny = size <= 16;
	const isSmall = size <= 32;
	const isMedium = size <= 48;

	// Adjust padding for small sizes (tighter fit)
	const padding = isTiny ? 1 : isSmall ? 2 : 8 * s;
	const drawSize = size - (padding * 2);
	const x = padding;
	const y = padding;
	// Increased corner radius for better rounded appearance
	const radius = isTiny ? 4 : isSmall ? 6 : 24 * s;

	// 1. Shadow (skip for tiny/small sizes for crispness)
	if (!isSmall) {
		ctx.save();
		ctx.shadowColor = 'rgba(6, 182, 212, 0.35)';
		ctx.shadowBlur = isMedium ? 6 * s : 12 * s;
		ctx.shadowOffsetY = isMedium ? 3 * s : 6 * s;

		drawSquircle(ctx, x, y, drawSize, drawSize, radius);
		ctx.fillStyle = '#000000';
		ctx.fill();
		ctx.restore();
	}

	// 2. Main Gradient Background
	const bgGrad = ctx.createLinearGradient(x, y, x + drawSize, y + drawSize);
	bgGrad.addColorStop(0, '#1D4ED8');   // Deep Blue
	bgGrad.addColorStop(0.5, '#3B82F6'); // Electric Blue
	bgGrad.addColorStop(1, '#06B6D4');   // Cyan

	drawSquircle(ctx, x, y, drawSize, drawSize, radius);
	ctx.fillStyle = bgGrad;
	ctx.fill();

	// 3. Clip and add details (adaptive by size)
	if (!isTiny) {
		ctx.save();
		drawSquircle(ctx, x, y, drawSize, drawSize, radius);
		ctx.clip();

		// Waves only for medium/large
		if (!isSmall) {
			// Wave 1 (Back) - only for 128px
			if (!isMedium) {
				ctx.beginPath();
				ctx.moveTo(0, size * 0.6);
				ctx.bezierCurveTo(size * 0.3, size * 0.55, size * 0.6, size * 0.75, size, size * 0.65);
				ctx.lineTo(size, size);
				ctx.lineTo(0, size);
				ctx.closePath();
				ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
				ctx.fill();
			}

			// Wave 2 (Front)
			ctx.beginPath();
			ctx.moveTo(0, size * 0.75);
			ctx.bezierCurveTo(size * 0.4, size * 0.65, size * 0.7, size * 0.85, size, size * 0.7);
			ctx.lineTo(size, size);
			ctx.lineTo(0, size);
			ctx.closePath();

			const waveGrad = ctx.createLinearGradient(0, size * 0.7, 0, size);
			const waveOpacity = isMedium ? 0.18 : 0.25;
			waveGrad.addColorStop(0, `rgba(255, 255, 255, ${waveOpacity})`);
			waveGrad.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
			ctx.fillStyle = waveGrad;
			ctx.fill();
		}

		// Top Gloss (all non-tiny sizes)
		const glossStrength = isTiny ? 0 : isSmall ? 0.15 : isMedium ? 0.2 : 0.25;
		const glossGrad = ctx.createLinearGradient(x, y, x, y + drawSize * 0.5);
		glossGrad.addColorStop(0, `rgba(255, 255, 255, ${glossStrength})`);
		glossGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

		ctx.beginPath();
		ctx.ellipse(size / 2, y, drawSize * 0.8, drawSize * 0.5, 0, 0, Math.PI * 2);
		ctx.fillStyle = glossGrad;
		ctx.fill();

		ctx.restore();
	}

	// 4. Play Button (core element - must be visible at all sizes)
	const centerX = size / 2;
	const centerY = size / 2;

	// Scale play button proportionally larger for small sizes
	const playScale = isTiny ? 0.65 : isSmall ? 0.55 : isMedium ? 0.38 : 0.28;
	const playSize = size * playScale;

	ctx.save();

	// Optical centering adjustment (play triangles look left-heavy)
	const offsetX = isTiny ? 1 : isSmall ? 1.5 * s : 4 * s;
	ctx.translate(centerX + offsetX, centerY);

	// Shadow only for larger sizes
	if (!isSmall) {
		ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
		ctx.shadowBlur = isMedium ? 2 * s : 4 * s;
		ctx.shadowOffsetY = isMedium ? 1 * s : 2 * s;
	}

	// Draw play triangle (with rounded corners for larger sizes)
	const h = playSize;
	const w = playSize * 0.866;

	if (isTiny || isSmall) {
		// Sharp triangle for small sizes (cleaner pixels)
		ctx.beginPath();
		ctx.moveTo(-w / 2, -h / 2);
		ctx.lineTo(-w / 2, h / 2);
		ctx.lineTo(w / 2, 0);
		ctx.closePath();
	} else {
		// Rounded triangle for larger sizes
		const r = Math.max(2, playSize * 0.1);
		const p1x = -w / 2; const p1y = -h / 2;
		const p2x = -w / 2; const p2y = h / 2;
		const p3x = w / 2; const p3y = 0;

		ctx.beginPath();
		ctx.moveTo(p1x, p1y + r);
		ctx.lineTo(p2x, p2y - r);
		ctx.quadraticCurveTo(p2x, p2y, p2x + r, p2y - (r * 0.5));
		ctx.lineTo(p3x - r, p3y + (r * 0.5));
		ctx.quadraticCurveTo(p3x, p3y, p3x - r, p3y - (r * 0.5));
		ctx.lineTo(p1x + r, p1y + (r * 0.5));
		ctx.quadraticCurveTo(p1x, p1y, p1x, p1y + r);
		ctx.closePath();
	}

	ctx.fillStyle = '#FFFFFF';
	ctx.fill();
	ctx.restore();
}

/**
 * Draw a continuous curvature squircle (super-ellipse approximation)
 */
function drawSquircle(ctx, x, y, w, h, r) {
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

// Generate all sizes
const sizes = [16, 32, 48, 128];

sizes.forEach(size => {
	const canvas = createCanvas(size, size);
	drawIcon(canvas, size);

	const buffer = canvas.toBuffer('image/png');
	const filename = path.join(__dirname, 'icons', `icon${size}.png`);
	fs.writeFileSync(filename, buffer);
	console.log(`✓ Generated icon${size}.png (${buffer.length} bytes)`);
});

console.log('\n🎨 VidFlow icons generated successfully');
console.log('   Design: Fluid Squircle - Size-Adaptive Edition');
console.log('   - 128px: Full detail (waves, gloss, shadow)');
console.log('   - 48px:  Moderate detail (front wave, gloss)');
console.log('   - 32px:  Simplified (gloss only)');
console.log('   - 16px:  Minimal (gradient + play button)');
