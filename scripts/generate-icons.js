#!/usr/bin/env node
/* global process */

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
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const iconsDir = join(__dirname, '..', 'public', 'icons');

// Ensure icons directory exists
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

async function generateIcons() {
  console.log('Generating icons from SVG sources...\n');

  const tasks = [
    // App icons from icon.svg
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
      
      await sharp(svgBuffer, { density: 150 })
        .resize(task.width, task.height)
        .png()
        .toFile(task.output);
      
      console.log(`✓ Generated ${task.description}`);
    } catch (error) {
      console.error(`✗ Failed to generate ${task.description}:`, error.message);
      process.exit(1);
    }
  }

  console.log('\n✅ All icons generated successfully!');
}

generateIcons().catch((error) => {
  console.error('Icon generation failed:', error);
  process.exit(1);
});
