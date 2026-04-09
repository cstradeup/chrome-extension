#!/usr/bin/env node

/**
 * package-extension.js — Packages the build/ directory into distributable
 * archives for Chrome (ZIP + CRX) and Firefox (XPI).
 *
 * Usage:
 *   BROWSER=chrome  node scripts/package-extension.js          # → dist/*.zip (+ *.crx if key present)
 *   BROWSER=firefox node scripts/package-extension.js          # → dist/*.xpi
 *
 * Environment variables:
 *   BROWSER          "chrome" | "firefox"  (default: "chrome")
 *   CRX_KEY_PATH     Path to .pem private key for CRX signing (optional)
 *   CRX_KEY_BASE64   Base64-encoded .pem key (CI-friendly, optional)
 *   SKIP_CRX         "1" to skip CRX creation even if key is available
 *
 * Outputs go to dist/ relative to the project root:
 *   dist/cstradeup-v{version}-chrome.zip
 *   dist/cstradeup-v{version}-chrome.crx    (Chrome only, key required)
 *   dist/cstradeup-v{version}-firefox.xpi   (Firefox only)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "build");
const DIST_DIR = path.join(ROOT, "dist");
const PKG = require(path.join(ROOT, "package.json"));

const BROWSER = process.env.BROWSER || "chrome";
const VERSION = PKG.version;
const NAME = "cstradeup";
const PREFIX = `${NAME}-v${VERSION}-${BROWSER}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function exec(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function fileSize(filePath) {
  const bytes = fs.statSync(filePath).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!fs.existsSync(BUILD_DIR)) {
  console.error(`Error: build/ directory not found. Run the build first:\n  pnpm build:${BROWSER}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(BUILD_DIR, "manifest.json"))) {
  console.error("Error: manifest.json not found in build/. Build may have failed.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create ZIP archive (works for both Chrome and Firefox)
// ---------------------------------------------------------------------------

function createZip(outputPath) {
  console.log(`\nCreating ZIP: ${path.basename(outputPath)}`);
  // Remove previous artifact if it exists
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  exec(`cd "${BUILD_DIR}" && zip -r "${outputPath}" . -x "*.DS_Store" -x "__MACOSX/*"`);
  console.log(`  ✓ ${path.basename(outputPath)} (${fileSize(outputPath)})`);
  return outputPath;
}

// ---------------------------------------------------------------------------
// Create CRX3 (Chrome only, requires private key)
// ---------------------------------------------------------------------------

function resolveCrxKey() {
  // 1. Explicit path
  if (process.env.CRX_KEY_PATH) {
    const keyPath = path.resolve(process.env.CRX_KEY_PATH);
    if (!fs.existsSync(keyPath)) {
      console.warn(`  ⚠ CRX_KEY_PATH set but file not found: ${keyPath}`);
      return null;
    }
    return keyPath;
  }

  // 2. Base64-encoded key (CI-friendly)
  if (process.env.CRX_KEY_BASE64) {
    const tmpKey = path.join(DIST_DIR, ".crx-key.pem");
    fs.writeFileSync(tmpKey, Buffer.from(process.env.CRX_KEY_BASE64, "base64"));
    return tmpKey;
  }

  // 3. Convention: key.pem in project root
  const defaultKey = path.join(ROOT, "key.pem");
  if (fs.existsSync(defaultKey)) {
    return defaultKey;
  }

  return null;
}

function createCrx(zipPath, outputPath) {
  if (process.env.SKIP_CRX === "1") {
    console.log("\n  Skipping CRX (SKIP_CRX=1)");
    return null;
  }

  const keyPath = resolveCrxKey();
  if (!keyPath) {
    console.log("\n  Skipping CRX (no signing key found)");
    console.log("  To enable CRX: set CRX_KEY_PATH, CRX_KEY_BASE64, or place key.pem in project root");
    return null;
  }

  console.log(`\nCreating CRX: ${path.basename(outputPath)}`);

  try {
    // Use crx3 CLI if available, fallback to npx
    const crx3Bin = path.join(ROOT, "node_modules", ".bin", "crx3");
    const crx3Cmd = fs.existsSync(crx3Bin) ? crx3Bin : "npx crx3";

    // crx3 packs a directory into a .crx file
    exec(`${crx3Cmd} "${BUILD_DIR}" -p "${keyPath}" -o "${outputPath}"`);
    console.log(`  ✓ ${path.basename(outputPath)} (${fileSize(outputPath)})`);

    // Clean up temp key if we created one
    const tmpKey = path.join(DIST_DIR, ".crx-key.pem");
    if (fs.existsSync(tmpKey)) fs.unlinkSync(tmpKey);

    return outputPath;
  } catch (e) {
    console.warn(`  ⚠ CRX creation failed: ${e.message}`);
    console.warn("  Install crx3: pnpm add -D crx3");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(`\n📦 Packaging ${BROWSER} extension v${VERSION}\n`);
  ensureDir(DIST_DIR);

  const artifacts = [];

  if (BROWSER === "chrome") {
    // Chrome: ZIP (for Web Store) + CRX (for website / self-hosting)
    const zipPath = path.join(DIST_DIR, `${PREFIX}.zip`);
    createZip(zipPath);
    artifacts.push(zipPath);

    const crxPath = path.join(DIST_DIR, `${PREFIX}.crx`);
    const crxResult = createCrx(zipPath, crxPath);
    if (crxResult) artifacts.push(crxResult);
  } else if (BROWSER === "firefox") {
    // Firefox: XPI (a ZIP with .xpi extension — for AMO and self-hosting)
    const xpiPath = path.join(DIST_DIR, `${PREFIX}.xpi`);
    createZip(xpiPath);
    artifacts.push(xpiPath);

    // Also create a .zip for AMO submission (some workflows prefer .zip)
    const zipPath = path.join(DIST_DIR, `${PREFIX}.zip`);
    createZip(zipPath);
    artifacts.push(zipPath);
  }

  console.log("\n✅ Packaging complete!");
  console.log("Artifacts:");
  artifacts.forEach((a) => console.log(`  → ${path.relative(ROOT, a)}`));
  console.log();
}

main();
