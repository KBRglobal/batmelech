'use strict';

// Lin's own encrypted login (set through the panel) must work alongside the
// Railway env pair, not replace it — Moshe's explicit ask was that changing
// BM_USER/BM_PASS on Railway must always keep working as a recovery key even
// after she sets her own username/password. No real Postgres here: a fake
// pool stands in for the one-row staff_credentials table.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const test = require('node:test');
const { encryptSecret } = require('../server/business-data/secret-box');
const { createDecoyLoginRouter } = require('../server/auth/decoy-login-route');

const ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const SESSION_SECRET = 'staff-pair-test-session-secret';

function fakePoolWithStaffPair(user, pass) {
  const usernameCiphertext = encryptSecret(user, ENCRYPTION_KEY);
  const passwordCiphertext = encryptSecret(pass, ENCRYPTION_KEY);
  return {
    async query() {
      return { rows: [{ username_ciphertext: usernameCiphertext, password_ciphertext: passwordCiphertext }] };
    },
  };
}

function startTestServer(pool) {
  const app = express();
  app.use(
    '/api/site/contact',
    createDecoyLoginRouter({
      authUser: 'env-user',
      authPass: 'env-pass',
      sessionSecret: SESSION_SECRET,
      pool,
      encryptionKey: ENCRYPTION_KEY,
    })
  );
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function cookieFrom(response, name) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    if (entry.startsWith(`${name}=`)) return entry.split(';')[0];
  }
  return null;
}

async function attempt(baseUrl, message, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}/api/site/contact`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  return { response, body };
}

test('the Railway env pair keeps working as a recovery key after Lin sets her own', async () => {
  const pool = fakePoolWithStaffPair('lin-staff-user', 'lin-staff-pass');
  const server = await startTestServer(pool);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const step1 = await attempt(baseUrl, 'env-user');
    assert.ok(step1.body.ref, 'the Railway username must still be accepted');
    const challenge1 = cookieFrom(step1.response, 'bm_rq');

    const step2 = await attempt(baseUrl, 'env-pass', challenge1);
    assert.ok(step2.body.ref, 'the Railway password must still log in');
    assert.ok(cookieFrom(step2.response, 'bm_ref'), 'a real session must be issued');
  } finally {
    server.close();
  }
});

test("Lin's own panel-set username/password also logs in", async () => {
  const pool = fakePoolWithStaffPair('lin-staff-user', 'lin-staff-pass');
  const server = await startTestServer(pool);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const step1 = await attempt(baseUrl, 'lin-staff-user');
    assert.ok(step1.body.ref, "Lin's own username must be accepted");
    const challenge1 = cookieFrom(step1.response, 'bm_rq');

    const step2 = await attempt(baseUrl, 'lin-staff-pass', challenge1);
    assert.ok(step2.body.ref, "Lin's own password must log in");
    assert.ok(cookieFrom(step2.response, 'bm_ref'), 'a real session must be issued');
  } finally {
    server.close();
  }
});

test('a username from one pair cannot be completed with the other pair\'s password', async () => {
  const pool = fakePoolWithStaffPair('lin-staff-user', 'lin-staff-pass');
  const server = await startTestServer(pool);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const step1 = await attempt(baseUrl, 'lin-staff-user');
    const challenge1 = cookieFrom(step1.response, 'bm_rq');

    const step2 = await attempt(baseUrl, 'env-pass', challenge1);
    assert.equal(step2.body.ref, undefined, 'the Railway password must not complete a staff-pair login');
  } finally {
    server.close();
  }
});
