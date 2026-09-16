'use strict';

// The public site is a React SPA. If the document that leaves the server is an
// empty <div id="root">, a crawler indexes a page with no words and no links —
// which is exactly what happened. These tests hold the two guarantees that fix
// it: every sitemap URL has stored markup, and the server injects it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { transformSiteIndexHtml, prerenderedBody } = require('../server/site-meta');

const siteRoot = path.join(__dirname, '..', 'site');
const indexHtml = fs.readFileSync(path.join(siteRoot, 'index.html'), 'utf8');

function sitemapPaths() {
  const xml = fs.readFileSync(path.join(siteRoot, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)]
    .map((match) => new URL(match[1].trim()).pathname.replace(/\/+$/u, '') || '/');
}

function visibleText(html) {
  return html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
}

test('every URL in the sitemap has prerendered markup with real content', () => {
  const missing = [];
  for (const pathname of sitemapPaths()) {
    const body = prerenderedBody(pathname);
    if (!body || visibleText(body).split(' ').length < 60) missing.push(pathname);
  }
  assert.deepEqual(missing, [], `pages without usable prerendered markup: ${missing.join(', ')}`);
});

test('the served document carries the page text and its internal links', () => {
  const html = transformSiteIndexHtml(indexHtml, '/weekdays');
  const body = html.split('<div id="root">')[1] || '';
  assert.ok(visibleText(body).length > 400, 'prerendered body was not injected');
  assert.ok(body.includes('<a '), 'prerendered body carries no links for a crawler to follow');
});

test('a Hebrew URL is served in Hebrew and an English one in English', () => {
  const hebrew = transformSiteIndexHtml(indexHtml, '/');
  const english = transformSiteIndexHtml(indexHtml, '/en');
  assert.match(hebrew, /<html lang="he" dir="rtl"/u);
  assert.ok(/[֐-׿]/u.test(visibleText(hebrew.split('<div id="root">')[1] || '')));
  assert.match(english, /<html lang="en" dir="ltr"/u);
});

test('an unknown path still renders — it just carries no stored markup', () => {
  const html = transformSiteIndexHtml(indexHtml, '/no-such-page');
  assert.ok(html.includes('<div id="root"></div>'));
  assert.equal(prerenderedBody('/../server/site-meta.js'), '');
});
