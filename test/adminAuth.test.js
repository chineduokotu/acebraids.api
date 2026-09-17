import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../models/User.js';

// Always launch an isolated database. Never use MONGODB_URI or the app's
// connection helper, which can fall back to a developer's local database.
const TEST_SECRET = 'admin-auth-integration-test-secret-at-least-32-characters';
const INITIAL_PASSWORD = 'original admin passphrase';
const NEW_PASSWORD = 'a different admin passphrase';
const originalEnv = {
  JWT_SECRET: process.env.JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV,
  CLIENT_URL: process.env.CLIENT_URL,
};
let database;
let httpServer;
let baseUrl;
let admin;
let adminToken;

const attempts = () => mongoose.connection.collection('passwordchangeattempts');

async function request(path, { method = 'GET', token, cookie, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function changePassword(body = {}, options = {}) {
  return request('/api/auth/admin/change-password', {
    method: 'POST',
    token: adminToken,
    body: {
      currentPassword: INITIAL_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      ...body,
    },
    ...options,
  });
}

function assertNoCredentials(responseBody, extraSecrets = []) {
  const serialized = JSON.stringify(responseBody);
  for (const secret of [INITIAL_PASSWORD, NEW_PASSWORD, ...extraSecrets]) {
    assert.equal(serialized.includes(secret), false, 'Response must not expose submitted credentials');
  }
  assert.doesNotMatch(serialized, /\$2[aby]\$\d{2}\$/, 'Response must not expose bcrypt hashes');
  for (const field of ['password', 'currentPassword', 'newPassword', 'confirmPassword']) {
    assert.equal(Object.hasOwn(responseBody, field), false, 'Response must not expose password fields');
  }
  if (responseBody.token) {
    const payload = jwt.verify(responseBody.token, TEST_SECRET);
    for (const field of ['password', 'currentPassword', 'newPassword', 'confirmPassword']) {
      assert.equal(Object.hasOwn(payload, field), false, 'JWT must not contain credentials');
    }
  }
}

async function assertOriginalPasswordUnchanged() {
  const stored = await User.findById(admin._id).select('+password');
  assert.equal(await bcrypt.compare(INITIAL_PASSWORD, stored.password), true);
  assert.equal(stored.authVersion ?? 0, 0);
}

before(async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.NODE_ENV = 'test';
  process.env.CLIENT_URL = 'http://admin-auth-test.invalid';
  database = await MongoMemoryServer.create({
    instance: { dbName: `admin_auth_test_${process.pid}` },
  });
  await mongoose.connect(database.getUri());
  const { default: app } = await import('../app.js');
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  httpServer = app.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
}, { timeout: 120_000 });

beforeEach(async () => {
  await User.deleteMany({});
  await attempts().deleteMany({});
  admin = await User.create({
    name: 'Integration Admin',
    email: 'admin@example.test',
    password: INITIAL_PASSWORD,
    role: 'admin',
  });
  const login = await request('/api/auth/admin/login', {
    method: 'POST',
    body: { email: admin.email, password: INITIAL_PASSWORD },
  });
  assert.equal(login.status, 200);
  assertNoCredentials(login.body);
  adminToken = login.body.token;
});

after(async () => {
  if (httpServer) {
    await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
  await mongoose.disconnect();
  if (database) await database.stop();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('successful change stores a bcrypt hash, renews this session, and revokes all previous sessions', async () => {
  const otherLogin = await request('/api/auth/login', {
    method: 'POST', body: { email: admin.email, password: INITIAL_PASSWORD },
  });
  assert.equal(otherLogin.status, 200);
  const previousCookie = `jwt=${otherLogin.body.token}`;
  const response = await changePassword({}, { token: undefined, cookie: `jwt=${adminToken}` });
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.message, 'string');
  assert.equal(typeof response.body.token, 'string');
  assertNoCredentials(response.body);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/i);
  const renewedCookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal(decodeURIComponent(renewedCookie.slice(4)), response.body.token);

  const stored = await User.findById(admin._id).select('+password');
  assert.match(stored.password, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare(NEW_PASSWORD, stored.password), true);
  assert.equal(await bcrypt.compare(INITIAL_PASSWORD, stored.password), false);
  assert.equal(stored.authVersion, 1);
  assert.equal(jwt.verify(response.body.token, TEST_SECRET).authVersion, 1);

  for (const credentials of [{ token: adminToken }, { token: otherLogin.body.token }, { cookie: previousCookie }]) {
    for (const path of ['/api/auth/me', '/api/orders']) {
      assert.equal((await request(path, credentials)).status, 401, 'Old session must be revoked everywhere');
    }
    assert.equal((await request('/api/products', { ...credentials, method: 'POST', body: {} })).status, 401);
  }
  for (const credentials of [{ token: response.body.token }, { cookie: renewedCookie }]) {
    const me = await request('/api/auth/me', credentials);
    assert.equal(me.status, 200);
    assertNoCredentials(me.body);
    assert.equal((await request('/api/orders', credentials)).status, 200);
  }

  const oldLogin = await request('/api/auth/admin/login', {
    method: 'POST', body: { email: admin.email, password: INITIAL_PASSWORD },
  });
  assert.equal(oldLogin.status, 401);
  assertNoCredentials(oldLogin.body);
  for (const path of ['/api/auth/admin/login', '/api/auth/login']) {
    const newLogin = await request(path, {
      method: 'POST', body: { email: admin.email, password: NEW_PASSWORD },
    });
    assert.equal(newLogin.status, 200);
    assertNoCredentials(newLogin.body);
    assert.equal((await request('/api/auth/me', { token: newLogin.body.token })).status, 200);
  }
});

test('legacy user documents and JWTs without authVersion work until the password changes', async () => {
  await User.collection.updateOne({ _id: admin._id }, { $unset: { authVersion: '' } });
  const legacyToken = jwt.sign({ id: admin._id.toString(), role: 'admin' }, TEST_SECRET, { expiresIn: '1h' });
  assert.equal((await request('/api/auth/me', { token: legacyToken })).status, 200);
  const response = await changePassword({}, { token: legacyToken });
  assert.equal(response.status, 200);
  assert.equal((await request('/api/auth/me', { token: legacyToken })).status, 401);
  assert.equal((await request('/api/auth/me', { cookie: `jwt=${legacyToken}` })).status, 401);
  assert.equal((await request('/api/auth/me', { token: response.body.token })).status, 200);
});

test('saving an unrelated stale legacy user document cannot restore revoked sessions', async () => {
  await User.collection.updateOne({ _id: admin._id }, { $unset: { authVersion: '' } });
  const staleUser = await User.findById(admin._id);
  const legacyToken = jwt.sign({ id: admin._id.toString(), role: 'admin' }, TEST_SECRET, { expiresIn: '1h' });
  const response = await changePassword({}, { token: legacyToken });
  assert.equal(response.status, 200);
  staleUser.phone = '5550123';
  await staleUser.save();
  const stored = await User.findById(admin._id);
  assert.equal(stored.authVersion, 1);
  assert.equal((await request('/api/auth/me', { token: legacyToken })).status, 401);
  assert.equal((await request('/api/auth/me', { token: response.body.token })).status, 200);
});

test('incorrect current password fails without changing credentials or session version', async () => {
  const wrongPassword = 'incorrect current passphrase';
  const response = await changePassword({ currentPassword: wrongPassword });
  assert.equal(response.status, 400);
  assertNoCredentials(response.body, [wrongPassword]);
  await assertOriginalPasswordUnchanged();
  assert.equal((await request('/api/auth/me', { token: adminToken })).status, 200);
});

test('mismatched confirmation fails on the backend', async () => {
  const response = await changePassword({ confirmPassword: 'not the same passphrase' });
  assert.equal(response.status, 400);
  assertNoCredentials(response.body, ['not the same passphrase']);
  await assertOriginalPasswordUnchanged();
});

const invalidFields = [
  ['missing current password', { currentPassword: undefined }],
  ['missing new password', { newPassword: undefined }],
  ['missing confirmation', { confirmPassword: undefined }],
  ['object current password', { currentPassword: { $ne: null } }],
  ['array new password', { newPassword: [NEW_PASSWORD], confirmPassword: [NEW_PASSWORD] }],
  ['numeric confirmation', { confirmPassword: 123456789012345 }],
  ['null current password', { currentPassword: null }],
  ['empty current password', { currentPassword: '' }],
  ['oversized current password', { currentPassword: 'x'.repeat(1025) }],
];
for (const [description, fields] of invalidFields) {
  test(`rejects ${description} without modifying the account`, async () => {
    const response = await changePassword(fields);
    assert.equal(response.status, 400);
    assertNoCredentials(response.body);
    await assertOriginalPasswordUnchanged();
  });
}

for (const [description, password] of [
  ['14 ASCII characters', 'a'.repeat(14)],
  ['14 Unicode code points even when UTF-16 length exceeds 15', '\u{1f512}'.repeat(14)],
  ['73 UTF-8 bytes', 'a'.repeat(73)],
  ['19 emoji exceeding bcrypt\'s 72-byte limit', '\u{1f512}'.repeat(19)],
  ['all whitespace', ' '.repeat(15)],
  ['all Unicode whitespace', '\u2003'.repeat(15)],
  ['unchanged password', INITIAL_PASSWORD],
]) {
  test(`password policy rejects ${description}`, async () => {
    const response = await changePassword({ newPassword: password, confirmPassword: password });
    assert.equal(response.status, 400);
    assertNoCredentials(response.body, [password]);
    await assertOriginalPasswordUnchanged();
  });
}

for (const [description, password] of [
  ['15 ASCII characters without composition requirements', 'a'.repeat(15)],
  ['exactly 72 UTF-8 bytes', 'b'.repeat(72)],
  ['15 Unicode code points', '\u{1f512}'.repeat(15)],
  ['18 emoji at exactly 72 UTF-8 bytes', '\u{1f512}'.repeat(18)],
  ['spaces preserved as part of a passphrase', '  new spaced passphrase  '],
]) {
  test(`password policy accepts ${description}`, async () => {
    const response = await changePassword({ newPassword: password, confirmPassword: password });
    assert.equal(response.status, 200);
    assertNoCredentials(response.body, [password]);
    const stored = await User.findById(admin._id).select('+password');
    assert.equal(await bcrypt.compare(password, stored.password), true);
  });
}

test('unauthenticated, invalid, and expired tokens cannot change a password', async () => {
  const expiredToken = jwt.sign({ id: admin._id.toString(), role: 'admin', authVersion: 0 }, TEST_SECRET, { expiresIn: -1 });
  for (const token of [undefined, 'invalid-token', expiredToken]) {
    const response = await changePassword({}, { token });
    assert.equal(response.status, 401);
    assertNoCredentials(response.body);
  }
  assert.equal(await attempts().countDocuments(), 0);
  await assertOriginalPasswordUnchanged();
});

test('a customer cannot change an admin password even with a forged role claim or supplied admin ID', async () => {
  const customer = await User.create({ name: 'Customer', email: 'customer@example.test', password: INITIAL_PASSWORD });
  const customerLogin = await request('/api/auth/login', {
    method: 'POST', body: { email: customer.email, password: INITIAL_PASSWORD },
  });
  assert.equal(customerLogin.status, 200);
  const misleadingRoleToken = jwt.sign({ id: customer._id.toString(), role: 'admin', authVersion: 0 }, TEST_SECRET, { expiresIn: '1h' });
  for (const token of [customerLogin.body.token, misleadingRoleToken]) {
    const response = await changePassword({ userId: admin._id.toString(), email: admin.email }, { token });
    assert.equal(response.status, 403);
    assertNoCredentials(response.body);
  }
  assert.equal(await attempts().countDocuments(), 0);
  await assertOriginalPasswordUnchanged();
});

test('untrusted browser origins cannot submit a password change', async () => {
  const response = await changePassword({}, { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(response.status, 403);
  await assertOriginalPasswordUnchanged();
});

test('the configured application origin can submit a password change', async () => {
  const response = await changePassword({}, { headers: { Origin: process.env.CLIENT_URL } });
  assert.equal(response.status, 200);
});

test('comma-separated configured application origins can submit a password change', async () => {
  process.env.CLIENT_URL = 'http://admin-auth-test.invalid, https://acebraids.vercel.app';
  const localResponse = await changePassword({}, { headers: { Origin: 'http://admin-auth-test.invalid' } });
  assert.equal(localResponse.status, 200);
  const vercelResponse = await request('/api/auth/admin/change-password', {
    method: 'POST',
    token: localResponse.body.token,
    headers: { Origin: 'https://acebraids.vercel.app' },
    body: {
      currentPassword: NEW_PASSWORD,
      newPassword: 'the third admin passphrase',
      confirmPassword: 'the third admin passphrase',
    },
  });
  assert.equal(vercelResponse.status, 200);
});

test('a form-encoded browser request cannot change a password', async () => {
  const response = await fetch(`${baseUrl}/api/auth/admin/change-password`, {
    method: 'POST',
    headers: { Cookie: `jwt=${adminToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ currentPassword: INITIAL_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
  });
  assert.equal(response.status, 415);
  assertNoCredentials(await response.json());
  await assertOriginalPasswordUnchanged();
});

test('malformed JSON returns a safe error without echoing credentials or a parser stack', async () => {
  // Express routes accept mixed case, and the auth body parser also handles
  // its exact mount path. Neither spelling may expose parser input snippets.
  for (const path of ['/api/auth/admin/change-password', '/API/AUTH/admin/change-password', '/api/auth?test=1']) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: `{"currentPassword":"${INITIAL_PASSWORD}",`,
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assertNoCredentials(body);
    assert.equal(Object.hasOwn(body, 'stack'), false);
  }
  await assertOriginalPasswordUnchanged();
});

test('oversized authentication request bodies are rejected safely', async () => {
  const response = await changePassword({ currentPassword: 'p'.repeat(9 * 1024) });
  assert.equal(response.status, 413);
  assertNoCredentials(response.body);
  assert.equal(Object.hasOwn(response.body, 'stack'), false);
  await assertOriginalPasswordUnchanged();
});

test('missing and short signing secrets cannot issue or validate sessions', async () => {
  for (const configuredSecret of [undefined, 'too-short']) {
    try {
      if (configuredSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = configuredSecret;
      const response = await request('/api/auth/admin/login', {
        method: 'POST', body: { email: admin.email, password: INITIAL_PASSWORD },
      });
      assert.equal(response.status, 500);
      assert.equal(Object.hasOwn(response.body, 'token'), false);
      assert.equal(response.headers.get('set-cookie'), null);
      assertNoCredentials(response.body);
      assert.equal((await request('/api/auth/me', { token: adminToken })).status, 401);
    } finally {
      process.env.JWT_SECRET = TEST_SECRET;
    }
  }
  await assertOriginalPasswordUnchanged();
});

test('rate limit counts failed validation and survives obtaining another session', async () => {
  for (let index = 0; index < 5; index += 1) {
    const response = await changePassword(index % 2 === 0
      ? { currentPassword: 'wrong current passphrase' }
      : { confirmPassword: 'different confirmation passphrase' });
    assert.equal(response.status, 400);
  }
  const anotherLogin = await request('/api/auth/admin/login', {
    method: 'POST', body: { email: admin.email, password: INITIAL_PASSWORD },
  });
  assert.equal(anotherLogin.status, 200);
  const blocked = await changePassword({}, { token: anotherLogin.body.token });
  assert.equal(blocked.status, 429);
  const retryAfter = Number(blocked.headers.get('retry-after'));
  assert.ok(retryAfter > 0 && retryAfter <= 900);
  assertNoCredentials(blocked.body);
  const persisted = await attempts().findOne({ _id: admin._id });
  assert.ok(persisted, 'Counter must be persisted in MongoDB');
  assert.ok(persisted.attempts >= 5);
  await assertOriginalPasswordUnchanged();

  // Expire the stored window directly; avoid sleeping or relying on TTL cleanup.
  await attempts().updateOne({ _id: admin._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await changePassword()).status, 200);
  assert.equal((await attempts().findOne({ _id: admin._id })).attempts, 1);
});

test('successful changes also consume attempts and limits remain scoped to each admin', async () => {
  let currentPassword = INITIAL_PASSWORD;
  let token = adminToken;
  for (let index = 0; index < 5; index += 1) {
    const newPassword = `replacement admin passphrase ${index}`;
    const response = await changePassword({ currentPassword, newPassword, confirmPassword: newPassword }, { token });
    assert.equal(response.status, 200);
    currentPassword = newPassword;
    token = response.body.token;
  }
  assert.equal((await changePassword({ currentPassword }, { token })).status, 429);
  const otherAdmin = await User.create({ name: 'Other Admin', email: 'other-admin@example.test', password: INITIAL_PASSWORD, role: 'admin' });
  const otherLogin = await request('/api/auth/admin/login', {
    method: 'POST', body: { email: otherAdmin.email, password: INITIAL_PASSWORD },
  });
  assert.equal(otherLogin.status, 200);
  assert.equal((await changePassword({}, { token: otherLogin.body.token })).status, 200);
});

test('concurrent attempts cannot bypass the persistent rate limit', async () => {
  const responses = await Promise.all(Array.from({ length: 7 }, () => changePassword({ currentPassword: 'wrong current passphrase' })));
  assert.equal(responses.filter((response) => response.status === 400).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 2);
  assert.ok((await attempts().findOne({ _id: admin._id })).attempts >= 5);
  await assertOriginalPasswordUnchanged();
});

test('concurrent password changes permit a single winner and retain its valid session', async () => {
  const alternatives = ['first replacement passphrase', 'second replacement passphrase'];
  const responses = await Promise.all(alternatives.map((newPassword) => changePassword({ newPassword, confirmPassword: newPassword })));
  const winners = responses.filter((response) => response.status === 200);
  assert.equal(winners.length, 1);
  assert.equal(responses.filter((response) => [401, 409].includes(response.status)).length, 1);
  const stored = await User.findById(admin._id).select('+password');
  assert.equal(stored.authVersion, 1);
  const winnerIndex = responses.findIndex((response) => response.status === 200);
  assert.equal(await bcrypt.compare(alternatives[winnerIndex], stored.password), true);
  assert.equal((await request('/api/auth/me', { token: winners[0].body.token })).status, 200);
  assert.equal((await request('/api/auth/me', { token: adminToken })).status, 401);
});
