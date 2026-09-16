// Prerenders the customer site into static HTML so crawlers get real content.
//
// The public site is a React SPA: the HTML that leaves the server is
// `<div id="root"></div>` and every word on the page only exists after the
// bundle runs. Search engines that skip or defer JavaScript saw an empty
// document, which is why the site carried no text into the index.
//
// This walks every URL in site/sitemap.xml with a real browser, waits for the
// page to settle, and stores the rendered markup of #root. server/site-meta.js
// injects the stored markup into the shell it already rewrites the head of, so
// the first byte of every page contains its headings, copy, menu and links.
// The client still boots normally and replaces the markup with the live app.
//
// Run after every customer-site build and before deploying:
//   node scripts/prerender-site.mjs                 (renders the local build)
//   node scripts/prerender-site.mjs https://www.batmelech.ae
//
// With no argument it serves the freshly built site/ itself and forwards only
// the catalog/status API calls to production, so the snapshot is always of the
// code in this working tree with real menu data — never of whatever is still
// live. Prices in a snapshot are a moment in time; the client app replaces
// them the instant it boots, so only crawlers ever read them.
//
// Playwright is a local build-time tool, not a server dependency. Point
// PLAYWRIGHT_MODULE at an installation if the lookup below misses.

import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'site', 'prerender');
const sitemapPath = path.join(repoRoot, 'site', 'sitemap.xml');

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  path.join(repoRoot, 'node_modules', 'playwright'),
  path.join(repoRoot, 'customer-site', 'node_modules', 'playwright'),
  '/Users/me/Documents/work/eventis/node_modules/playwright',
  '/Users/me/Documents/famanage/node_modules/playwright',
].filter(Boolean);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try {
      if (candidate.startsWith('/') && !existsSync(candidate)) continue;
      return require(candidate);
    } catch {
      // try the next location
    }
  }
  throw new Error(
    'Playwright not found. Install it here, or set PLAYWRIGHT_MODULE to an existing installation.'
  );
}

// "https://www.batmelech.ae/en/weekdays" -> "/en/weekdays"
async function sitemapPaths() {
  const xml = await readFile(sitemapPath, 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1].trim());
  const paths = urls.map((url) => new URL(url).pathname.replace(/\/+$/u, '') || '/');
  return [...new Set(paths)];
}

// Hebrew URLs must be rendered by a Hebrew browser and English ones by an
// English browser: anything the app reads off the device has to match the URL.
function localeOf(pathname) {
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en-US';
  if (pathname === '/fr' || pathname.startsWith('/fr/')) return 'fr-FR';
  return 'he-IL';
}

// "/en/experiences/yacht" -> "en_experiences_yacht"; "/" -> "index"
export function slugOf(pathname) {
  const trimmed = pathname.replace(/^\/+|\/+$/gu, '');
  return trimmed === '' ? 'index' : trimmed.replace(/\//gu, '_');
}

const UPSTREAM_API = 'https://www.batmelech.ae';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// Serves the build in site/ exactly the way the server does (same head
// rewriting), and forwards /api/site/* to production so menus, prices and
// availability are the live ones.
async function startLocalServer() {
  const require = createRequire(import.meta.url);
  const { transformSiteIndexHtml } = require(path.join(repoRoot, 'server', 'site-meta.js'));
  const siteRoot = path.join(repoRoot, 'site');
  const shell = await readFile(path.join(siteRoot, 'index.html'), 'utf8');

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const upstream = await fetch(`${UPSTREAM_API}${request.url}`, {
          headers: { accept: 'application/json' },
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') || 'application/json',
        });
        return response.end(body);
      }
      const extension = path.extname(url.pathname);
      if (extension !== '') {
        const relative = url.pathname.replace(/^\/site\//u, '/').replace(/^\/+/u, '');
        const file = path.join(siteRoot, relative);
        if (!file.startsWith(siteRoot)) {
          response.writeHead(403);
          return response.end();
        }
        const data = await readFile(file);
        response.writeHead(200, { 'content-type': MIME[extension] || 'application/octet-stream' });
        return response.end(data);
      }
      response.writeHead(200, { 'content-type': MIME['.html'] });
      // The shell only: a snapshot must never be built from an older snapshot.
      return response.end(transformSiteIndexHtml(shell, url.pathname));
    } catch {
      response.writeHead(404);
      return response.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function main() {
  const explicitBase = process.argv[2];
  const { chromium } = loadPlaywright();
  const paths = await sitemapPaths();

  // Clear first: the local server serves the same shell the real one does, and
  // it must not find yesterday's snapshot to inject into today's.
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const local = explicitBase ? null : await startLocalServer();
  const base = (explicitBase || local.base).replace(/\/+$/u, '');

  const browser = await chromium.launch();
  const failures = [];
  let written = 0;

  for (const locale of ['he-IL', 'en-US', 'fr-FR']) {
    const group = paths.filter((pathname) => localeOf(pathname) === locale);
    if (group.length === 0) continue;
    const context = await browser.newContext({
      locale,
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 BatMelechPrerender',
    });
    const page = await context.newPage();
    for (const pathname of group) {
      try {
        const response = await page.goto(`${base}${pathname}`, {
          waitUntil: 'networkidle',
          timeout: 60000,
        });
        if (response && response.status() >= 400) {
          failures.push(`${pathname} -> HTTP ${response.status()}`);
          continue;
        }
        // The app must have landed on the URL we asked for, and it must have
        // rendered something substantial — never store a redirect or a shell.
        const landed = new URL(page.url()).pathname.replace(/\/+$/u, '') || '/';
        if (landed !== pathname) {
          failures.push(`${pathname} -> redirected to ${landed}`);
          continue;
        }
        const markup = await page.evaluate(() => {
          const root = document.getElementById('root');
          if (!root) return null;
          // Live regions, chat state and anything the app marks as volatile do
          // not belong in a stored snapshot.
          const clone = root.cloneNode(true);
          for (const node of clone.querySelectorAll('[data-no-prerender], script, noscript')) {
            node.remove();
          }
          return clone.innerHTML;
        });
        const words = await page.evaluate(() =>
          document.body.innerText.replace(/\s+/gu, ' ').trim().split(' ').length
        );
        if (!markup || words < 60) {
          failures.push(`${pathname} -> too little content (${words} words)`);
          continue;
        }
        await writeFile(path.join(outputDir, `${slugOf(pathname)}.html`), markup, 'utf8');
        written += 1;
        process.stdout.write(`${pathname} (${words} words)\n`);
      } catch (error) {
        failures.push(`${pathname} -> ${error.message}`);
      }
    }
    await context.close();
  }
  await browser.close();
  if (local) local.close();

  process.stdout.write(`\nprerendered ${written}/${paths.length} pages into site/prerender\n`);
  if (failures.length > 0) {
    process.stdout.write(`failed:\n  ${failures.join('\n  ')}\n`);
    process.exitCode = 1;
  }
}

await main();
