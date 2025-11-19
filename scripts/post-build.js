#!/usr/bin/env node

/**
 * Post-build script to fix HTML files
 *
 * Vite doesn't properly transform navbar.html and overlay.html during build,
 * so we need to manually replace the development script tags with production bundle references.
 */

const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '../build');
const staticDir = path.join(buildDir, 'static');

console.log('[Post-Build] Fixing HTML files...');

// Find all generated JS and CSS files
const files = fs.existsSync(staticDir) ? fs.readdirSync(staticDir).map(f => 'static/' + f) : [];

const bundles = {
  global: { css: null },
  navbar: { js: null, css: null },
  overlay: { js: null, css: null }
};

// Map files to their types
files.forEach(file => {
  const basename = path.basename(file);
  if (basename.startsWith('global-') && basename.endsWith('.css')) {
    bundles.global.css = file;
  } else if (basename.startsWith('navbar-') && basename.endsWith('.js')) {
    bundles.navbar.js = file;
  } else if (basename.startsWith('navbar-') && basename.endsWith('.css')) {
    bundles.navbar.css = file;
  } else if (basename.startsWith('overlay-') && basename.endsWith('.js')) {
    bundles.overlay.js = file;
  } else if (basename.startsWith('overlay-') && basename.endsWith('.css')) {
    bundles.overlay.css = file;
  }
});

console.log('[Post-Build] Found bundles:', bundles);

// Fix navbar.html
const navbarHtmlPath = path.join(buildDir, 'navbar.html');
if (fs.existsSync(navbarHtmlPath) && bundles.navbar.js) {
  let navbarHtml = fs.readFileSync(navbarHtmlPath, 'utf8');

  // Build CSS links (global first, then component-specific)
  const cssLinks = [
    bundles.global.css ? `<link rel="stylesheet" href="./${bundles.global.css}">` : null,
    bundles.navbar.css ? `<link rel="stylesheet" href="./${bundles.navbar.css}">` : null
  ].filter(Boolean).join('\n');

  // Replace script tag
  navbarHtml = navbarHtml.replace(
    /<script type="module" src="\/src\/navbar\/index\.js"><\/script>/,
    `${cssLinks}\n<script type="module" src="./${bundles.navbar.js}"></script>`
  );

  fs.writeFileSync(navbarHtmlPath, navbarHtml);
  console.log('[Post-Build] ✅ Fixed navbar.html');
} else {
  console.log('[Post-Build] ⚠️  navbar.html or bundle not found');
}

// Fix overlay.html
const overlayHtmlPath = path.join(buildDir, 'overlay.html');
if (fs.existsSync(overlayHtmlPath) && bundles.overlay.js) {
  let overlayHtml = fs.readFileSync(overlayHtmlPath, 'utf8');

  // Build CSS links (global first, then component-specific)
  const cssLinks = [
    bundles.global.css ? `<link rel="stylesheet" href="./${bundles.global.css}">` : null,
    bundles.overlay.css ? `<link rel="stylesheet" href="./${bundles.overlay.css}">` : null
  ].filter(Boolean).join('\n');

  // Replace script tag
  overlayHtml = overlayHtml.replace(
    /<script type="module" src="\/src\/overlay\/index\.js"><\/script>/,
    `${cssLinks}\n<script type="module" src="./${bundles.overlay.js}"></script>`
  );

  fs.writeFileSync(overlayHtmlPath, overlayHtml);
  console.log('[Post-Build] ✅ Fixed overlay.html');
} else {
  console.log('[Post-Build] ⚠️  overlay.html or bundle not found');
}

console.log('[Post-Build] Done!');
