#!/usr/bin/env node

/**
 * Icon Generation Script
 * Converts SVG source icons to PNG formats for PWA and social sharing
 * 
 * Usage: npm run icons
 * 
 * Source SVGs should be designed with:
 * - icon.svg: Primary app icon with dark mode support
 * - icon-maskable.svg: Padded variant for Android adaptive icons (40% safe zone)
 * - og-image.svg: Social preview (1200x630), text as paths to avoid font issues
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const iconsDir = join(__dirname, '..', 'public', 'icons');

// Ensure icons directory exists
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

/**
 * Compute the density needed so sharp rasterizes the SVG at least as large
 * as the target dimensions (avoids upscaling a low-res raster).
 * SVG default density is 72 DPI, so a viewBox of W maps to W pixels at 72 DPI.
 */
function densityForSize(svgBuffer, targetWidth, targetHeight) {
  const viewBox = svgBuffer.toString().match(/viewBox=["']\s*\S+\s+\S+\s+(\S+)\s+(\S+)/);
  if (!viewBox) return 150;
  const [vbWidth, vbHeight] = [parseFloat(viewBox[1]), parseFloat(viewBox[2])];
  const scale = Math.max(targetWidth / vbWidth, targetHeight / vbHeight);
  return Math.max(72, Math.ceil(72 * scale));
}

async function generateIcons() {
  console.log('Generating icons from SVG sources...\n');

  const tasks = [
    // App icons from icon.svg
    {
      input: join(iconsDir, 'icon.svg'),
      output: join(iconsDir, 'icon-48.png'),
      width: 48,
      height: 48,
      description: 'icon-48.png (PWA icon small)'
    },
    {
      input: join(iconsDir, 'icon.svg'),
      output: join(iconsDir, 'icon-192.png'),
      width: 192,
      height: 192,
      description: 'icon-192.png (PWA icon)'
    },
    {
      input: join(iconsDir, 'icon.svg'),
      output: join(iconsDir, 'icon-512.png'),
      width: 512,
      height: 512,
      description: 'icon-512.png (PWA icon)'
    },
    {
      input: join(iconsDir, 'icon.svg'),
      output: join(iconsDir, 'apple-touch-icon.png'),
      width: 180,
      height: 180,
      description: 'apple-touch-icon.png (iOS)'
    },
    // Maskable icon
    {
      input: join(iconsDir, 'icon-maskable.svg'),
      output: join(iconsDir, 'icon-maskable-192.png'),
      width: 192,
      height: 192,
      description: 'icon-maskable-192.png (Android adaptive)'
    },
    {
      input: join(iconsDir, 'icon-maskable.svg'),
      output: join(iconsDir, 'icon-maskable-512.png'),
      width: 512,
      height: 512,
      description: 'icon-maskable-512.png (Android adaptive)'
    },
    // Open Graph image
    {
      input: join(iconsDir, 'og-image.svg'),
      output: join(iconsDir, 'og-image.png'),
      width: 1200,
      height: 630,
      description: 'og-image.png (social sharing)'
    }
  ];

  for (const task of tasks) {
    try {
      const svgBuffer = readFileSync(task.input);
      const density = densityForSize(svgBuffer, task.width, task.height);
      
      await sharp(svgBuffer, { density })
        .resize(task.width, task.height)
        .png()
        .toFile(task.output);
      
      console.log(`✓ Generated ${task.description}`);
    } catch (error) {
      console.error(`✗ Failed to generate ${task.description}:`, error.message);
      process.exit(1);
    }
  }

  // Generate favicon.ico (multi-size ICO: 16, 32, 48)
  try {
    const svgBuffer = readFileSync(join(iconsDir, 'icon.svg'));
    const sizes = [16, 32, 48];
    const pngBuffers = await Promise.all(
      sizes.map(size =>
        sharp(svgBuffer, { density: densityForSize(svgBuffer, size, size) })
          .resize(size, size)
          .png()
          .toBuffer()
      )
    );
    const icoBuffer = buildIco(pngBuffers, sizes);
    writeFileSync(join(__dirname, '..', 'public', 'favicon.ico'), icoBuffer);
    console.log('✓ Generated favicon.ico (16×16, 32×32, 48×48)');
  } catch (error) {
    console.error('✗ Failed to generate favicon.ico:', error.message);
    process.exit(1);
  }

  console.log('\n✅ All icons generated successfully!');
}

/**
 * Build an ICO file from PNG buffers.
 * ICO format: 6-byte header + 16-byte entry per image + PNG data
 */
function buildIco(pngBuffers, sizes) {
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + entrySize * numImages;

  // Calculate total size
  const totalDataSize = pngBuffers.reduce((sum, buf) => sum + buf.length, 0);
  const ico = Buffer.alloc(dataOffset + totalDataSize);

  // ICO header: reserved(2) + type(2, 1=ICO) + count(2)
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(numImages, 4);

  let currentDataOffset = dataOffset;
  for (let i = 0; i < numImages; i++) {
    const png = pngBuffers[i];
    const size = sizes[i];
    const entryOffset = headerSize + i * entrySize;

    // Entry: width(1) + height(1) + palette(1) + reserved(1) +
    //        planes(2) + bpp(2) + dataSize(4) + dataOffset(4)
    ico.writeUInt8(size < 256 ? size : 0, entryOffset);
    ico.writeUInt8(size < 256 ? size : 0, entryOffset + 1);
    ico.writeUInt8(0, entryOffset + 2);
    ico.writeUInt8(0, entryOffset + 3);
    ico.writeUInt16LE(1, entryOffset + 4);
    ico.writeUInt16LE(32, entryOffset + 6);
    ico.writeUInt32LE(png.length, entryOffset + 8);
    ico.writeUInt32LE(currentDataOffset, entryOffset + 12);

    png.copy(ico, currentDataOffset);
    currentDataOffset += png.length;
  }

  return ico;
}

generateIcons().catch((error) => {
  console.error('Icon generation failed:', error);
  process.exit(1);
});
