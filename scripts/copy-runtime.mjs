// Post-build packaging for issue "dev project vs. loadable extension".
//
// dist-extension/ is the ONLY directory Chrome can "Load unpacked". Vite has
// already emitted the React workspace bundle into dist-extension/workspace/.
// This script copies the extension runtime files from the repository root by
// computing the reference closure:
//
//   manifest.json  +  every root *.html entry
//     -> local paths referenced by the manifest
//     -> local src/href referenced by the HTML pages
//     -> importScripts()/getURL() references inside copied JS
//
// Because the set is derived from references, development-only files
// (node_modules, src, vite.config.js, package.json, scripts, tests, ...) are
// never copied, and a missing referenced asset fails the build.

import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist-extension');
const ASSET_RE = /^[\w./-]+\.(js|css|html|png|jpe?g|svg|gif|webp|ico|json|wasm|woff2?|ttf|map)$/i;

const toPosix = p => p.split(path.sep).join('/');
const isLocalRef = ref => {
  const clean = ref.split(/[?#]/)[0];
  return !!clean && !/^[a-z][\w+.-]*:/i.test(clean) && !clean.startsWith('//') && !clean.startsWith('data:');
};
const normalizeRef = ref => {
  const clean = ref.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\/+/, '');
  return toPosix(path.posix.normalize(clean));
};

function collectJsonStrings(value, out) {
  if (typeof value === 'string') {
    const clean = value.split(/[?#]/)[0];
    if (isLocalRef(value) && ASSET_RE.test(clean)) out.add(normalizeRef(value));
  } else if (Array.isArray(value)) {
    value.forEach(item => collectJsonStrings(item, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectJsonStrings(item, out));
  }
}

function collectHtmlRefs(html) {
  const out = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    if (isLocalRef(m[1])) out.add(normalizeRef(m[1]));
  }
  return out;
}

function collectJsRefs(source) {
  const out = new Set();
  const patterns = [
    /importScripts\s*\(\s*["']([^"']+)["']/g,
    /getURL\s*\(\s*["']([^"']+)["']/g
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      if (isLocalRef(m[1])) out.add(normalizeRef(m[1]));
    }
  }
  return out;
}

async function ensureCleanDist() {
  await mkdir(DIST, { recursive: true });
  // Keep the Vite-built workspace/ subfolder; replace everything else.
  const entries = await readdir(DIST);
  await Promise.all(entries
    .filter(name => name !== 'workspace')
    .map(name => rm(path.join(DIST, name), { recursive: true, force: true })));
}

async function main() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  // Entry pages: the manifest plus every HTML page at the repository root
  // (planner.html is a packaged extension window even though nothing opens it
  // through getURL today).
  const rootFiles = await readdir(ROOT, { withFileTypes: true });
  const htmlEntries = rootFiles
    .filter(e => e.isFile() && /\.html$/i.test(e.name))
    .map(e => e.name);

  const refs = new Set(['manifest.json', ...htmlEntries]);
  collectJsonStrings(manifest, refs);
  for (const htmlName of htmlEntries) {
    collectHtmlRefs(await readFile(path.join(ROOT, htmlName), 'utf8')).forEach(r => refs.add(r));
  }

  // Fixed-point scan of JS references (importScripts, getURL, ...).
  const scanned = new Set();
  let pending = [...refs].filter(f => /\.js$/i.test(f));
  while (pending.length) {
    const file = pending.pop();
    if (scanned.has(file)) continue;
    scanned.add(file);
    const sourceAbs = path.join(ROOT, file);
    const builtAbs = path.join(DIST, file);
    const source = existsSync(sourceAbs)
      ? await readFile(sourceAbs, 'utf8').catch(() => '')
      : existsSync(builtAbs)
        ? await readFile(builtAbs, 'utf8').catch(() => '')
        : '';
    for (const ref of collectJsRefs(source)) {
      if (!refs.has(ref)) {
        refs.add(ref);
        if (/\.js$/i.test(ref)) pending.push(ref);
      }
    }
  }

  await ensureCleanDist();

  const copied = [];
  const builtOnly = [];
  const missing = [];
  for (const file of [...refs].sort()) {
    const sourceAbs = path.join(ROOT, file);
    const distAbs = path.join(DIST, file);
    if (existsSync(sourceAbs)) {
      await mkdir(path.dirname(distAbs), { recursive: true });
      await cp(sourceAbs, distAbs);
      copied.push(file);
    } else if (existsSync(distAbs)) {
      builtOnly.push(file);
    } else {
      missing.push(file);
    }
  }

  // Final integrity assertion: every referenced path must exist in the package.
  const broken = [...refs].filter(f => !existsSync(path.join(DIST, f)));

  console.log(`dist-extension packaged: ${copied.length} runtime files copied`);
  console.log(`  build outputs reused: ${builtOnly.join(', ') || '(none)'}`);
  if (missing.length || broken.length) {
    console.error('Missing referenced files in dist-extension:');
    [...new Set([...missing, ...broken])].forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
