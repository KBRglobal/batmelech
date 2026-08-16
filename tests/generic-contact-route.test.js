'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const test = require('node:test');
const { createGenericContactRouter } = require('../server/auth/generic-contact-route');

const ROUTE_SOURCE = path.join(__dirname, '../server/auth/generic-contact-route.js');
const NOTIFY_ENV = 'CONTACT_NOTIFY_EMAIL';
const FROM_ENV = 'CONTACT_FROM_EMAIL';
const TEST_NOTIFY = 'notify@example.test';
const TEST_FROM = 'Website <noreply@example.test>';
const VISITOR_IP = '203.0.113.77';
const REFERER = 'https://example.test/missing-page';

function silentLogger() {
  return { log() {}, error() {} };
}

async function startTestServer({ resendApiKey = 'test-key', sendEmail } = {}) {
  const sends = [];
  const app = express();
  app.use(
    '/api/site/contact',
    createGenericContactRouter({
      resendApiKey,
      sendEmail: sendEmail ?? (async (payload) => { sends.push(payload); }),
      logger: silentLogger(),
    })
  );
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, '127.0.0.1', () => resolve(httpServer));
  });
  return { server, sends, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function postContact(baseUrl, { message = 'hello from the 404 form', headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/api/site/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  return { response, body };
}

function withContactEnv(values, run) {
  const previous = {
    [NOTIFY_ENV]: process.env[NOTIFY_ENV],
    [FROM_ENV]: process.env[FROM_ENV],
  };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

test('generic contact route source has no email address literals', () => {
  const source = fs.readFileSync(ROUTE_SOURCE, 'utf8');
  assert.doesNotMatch(source, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});

test('POST /api/site/contact returns received and skips send when notify env is unset', async () => {
  await withContactEnv({ [NOTIFY_ENV]: undefined, [FROM_ENV]: TEST_FROM }, async () => {
    const { server, sends, baseUrl } = await startTestServer();
    try {
      const { response, body } = await postContact(baseUrl);
      assert.equal(response.status, 200);
      assert.deepEqual(body, { status: 'received' });
      assert.equal(sends.length, 0);
    } finally {
      server.close();
    }
  });
});

test('POST /api/site/contact returns received and skips send when from env is unset', async () => {
  await withContactEnv({ [NOTIFY_ENV]: TEST_NOTIFY, [FROM_ENV]: undefined }, async () => {
    const { server, sends, baseUrl } = await startTestServer();
    try {
      const { response, body } = await postContact(baseUrl);
      assert.equal(response.status, 200);
      assert.deepEqual(body, { status: 'received' });
      assert.equal(sends.length, 0);
    } finally {
      server.close();
    }
  });
});

test('POST /api/site/contact skips send when notify env is empty or whitespace', async () => {
  await withContactEnv({ [NOTIFY_ENV]: '   ', [FROM_ENV]: TEST_FROM }, async () => {
    const { server, sends, baseUrl } = await startTestServer();
    try {
      const { response, body } = await postContact(baseUrl);
      assert.equal(response.status, 200);
      assert.deepEqual(body, { status: 'received' });
      assert.equal(sends.length, 0);
    } finally {
      server.close();
    }
  });
});

test('notification payload uses env addresses, keeps referer, and omits visitor IP', async () => {
  await withContactEnv({ [NOTIFY_ENV]: TEST_NOTIFY, [FROM_ENV]: TEST_FROM }, async () => {
    const { server, sends, baseUrl } = await startTestServer();
    try {
      const { response, body } = await postContact(baseUrl, {
        headers: { Referer: REFERER, 'X-Forwarded-For': VISITOR_IP },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(body, { status: 'received' });
      assert.equal(sends.length, 1);
      assert.equal(sends[0].to, TEST_NOTIFY);
      assert.equal(sends[0].from, TEST_FROM);
      assert.match(sends[0].html, /hello from the 404 form/);
      assert.match(sends[0].html, /https:\/\/example\.test\/missing-page/);

      const serialized = JSON.stringify(sends[0]);
      assert.doesNotMatch(serialized, /203\.0\.113\.77/);
      assert.doesNotMatch(serialized, /x-forwarded-for/i);
      assert.doesNotMatch(serialized, /כתובת IP/);
      assert.doesNotMatch(serialized, /\brequest\.ip\b/);
    } finally {
      server.close();
    }
  });
});
