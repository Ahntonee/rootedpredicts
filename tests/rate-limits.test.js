'use strict';
process.env.JWT_SECRET = 'test-only-rate-limit-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { generateToken } = require('../utils/jwt');
const { createApiLimiter, createAuthLimiter } = require('../middleware/rateLimits');

test('Admin, visitor, account and login quotas remain independent on the same IP', async () => {
  const app = express();
  app.use(cookieParser());
  app.use('/api', createApiLimiter({ public: { limit: 2 }, admin: { limit: 2 } }));
  app.use(express.json());
  const auth = express.Router();
  auth.post('/login', createAuthLimiter({ limit: 2 }), (req, res) => res.status(req.body.correct ? 200 : 401).json({ success: !!req.body.correct }));
  app.use('/api/auth', auth);
  app.get('/api/predictions', (req, res) => res.json({ success: true }));
  app.post('/api/admin/predictions', (req, res) => res.json({ success: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const admin = generateToken({ id: 1, role: 'admin' });
  const user = generateToken({ id: 2, role: 'user' });
  const other = generateToken({ id: 3, role: 'user' });
  async function request(url, token, body) {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: 'rp_token=' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    await response.json();
    return response.status;
  }
  try {
    assert.equal(await request('/api/admin/predictions', admin, {}), 200);
    assert.equal(await request('/api/admin/predictions', admin, {}), 200);
    assert.equal(await request('/api/admin/predictions', admin, {}), 429);
    assert.equal(await request('/api/predictions'), 200);
    assert.equal(await request('/api/predictions'), 200);
    assert.equal(await request('/api/predictions'), 429);
    assert.equal(await request('/api/predictions', user), 200);
    assert.equal(await request('/api/predictions', user), 200);
    assert.equal(await request('/api/predictions', user), 429);
    assert.equal(await request('/api/predictions', other), 200);
    // Public quota exhaustion cannot prevent a successful login; successes do not accumulate.
    for (let i = 0; i < 4; i++) assert.equal(await request('/api/auth/login', null, { email: 'admin@example.com', correct: true }), 200);
    for (let i = 0; i < 2; i++) assert.equal(await request('/api/auth/login', null, { email: 'bad@example.com' }), 401);
    assert.equal(await request('/api/auth/login', null, { email: 'bad@example.com' }), 429);
    assert.equal(await request('/api/auth/login', null, { email: 'another@example.com', correct: true }), 200);
    // Invalid tokens cannot create arbitrary fresh account quotas.
    assert.equal(await request('/api/predictions', 'forged'), 429);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
