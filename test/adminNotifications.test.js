import test, { after, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';

const SECRET = 'admin-notification-tests-only-signing-secret-32-plus';
const originalEnv = { JWT_SECRET: process.env.JWT_SECRET, CLIENT_URL: process.env.CLIENT_URL };
let database;
let server;
let baseUrl;
let admin;
let secondAdmin;
let customer;

const tokenFor = (user, options = {}) => jwt.sign({
  id: String(user._id), authVersion: user.authVersion ?? 0, role: 'admin',
}, SECRET, { expiresIn: '1h', ...options });

async function request(path = '', { token = tokenFor(admin), method = 'GET', headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/api/admin/notifications${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function createNotification({ createdAt = new Date(), reference = 'AB-PAYMENT-001' } = {}) {
  return Order.create({
    guestInfo: { firstName: 'Test', lastName: 'Buyer', email: 'buyer@example.test' },
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Braided Wig', qty: 2, price: 125,
      variant: { color: 'Black', length: '24 inches', capSize: 'Medium' } }],
    subtotal: 250, shippingFee: 5, total: 255, currency: 'GBP',
    paymentStatus: 'paid', paymentMethod: 'stripe', paymentRef: reference,
    trackingCode: `TEST-${new mongoose.Types.ObjectId()}`,
    adminPaymentNotification: {
      createdAt, eventId: `evt_${new mongoose.Types.ObjectId()}`, orderReference: reference,
      customer: { name: 'Test Buyer', email: 'buyer@example.test' },
      items: [{ name: 'Braided Wig', qty: 2, price: 125, variant: { color: 'Black', length: '24 inches', capSize: 'Medium' } }],
      amount: 255, amountMinor: 25500, currency: 'GBP', paymentStatus: 'paid', paymentMethod: 'stripe', readBy: [],
    },
  });
}

async function openStream(token = tokenFor(admin)) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/admin/notifications/stream`, {
    headers: { Cookie: `jwt=${token}` }, signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  return { controller, reader: response.body.getReader(), buffer: '' };
}

async function eventFrom(stream, eventName, timeoutMs = 7000) {
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), timeoutMs);
  });
  const read = async () => {
    while (true) {
      let separator;
      while ((separator = stream.buffer.indexOf('\n\n')) >= 0) {
        const frame = stream.buffer.slice(0, separator);
        stream.buffer = stream.buffer.slice(separator + 2);
        const lines = frame.split('\n');
        if (lines.includes(`event: ${eventName}`)) {
          return JSON.parse(lines.find((line) => line.startsWith('data: ')).slice(6));
        }
      }
      const { value, done } = await stream.reader.read();
      if (done) throw new Error(`Stream closed before ${eventName}`);
      stream.buffer += new TextDecoder().decode(value);
    }
  };
  try { return await Promise.race([read(), timedOut]); }
  finally { clearTimeout(timeout); }
}

before(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.CLIENT_URL = 'http://admin-notifications.test';
  database = await MongoMemoryServer.create({ instance: { dbName: `notifications_test_${process.pid}` } });
  await mongoose.connect(database.getUri());
  await Promise.all([User.init(), Order.init()]);
  const { default: app } = await import('../app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });

beforeEach(async () => {
  await Promise.all([Order.deleteMany({}), User.deleteMany({})]);
  [admin, secondAdmin, customer] = await User.create([
    { name: 'Admin', email: 'admin@example.test', password: 'test admin passphrase', role: 'admin' },
    { name: 'Second Admin', email: 'second@example.test', password: 'second admin passphrase', role: 'admin' },
    { name: 'Customer', email: 'customer@example.test', password: 'customer test passphrase', role: 'customer' },
  ]);
});

after(async () => {
  mock.restoreAll();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  if (database) await database.stop();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('durable offline notifications include payment details and omit internal fields', async () => {
  const order = await createNotification();
  // The original snapshot must survive later edits to the order.
  await Order.updateOne({ _id: order._id }, { $set: { 'items.0.name': 'Renamed product' } });
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.body.unreadCount, 1);
  assert.equal(response.body.nextCursor, null);
  const notification = response.body.notifications[0];
  assert.equal(notification.id, String(order._id));
  assert.equal(notification.orderId, String(order._id));
  assert.equal(notification.orderReference, order.paymentRef);
  assert.deepEqual(notification.customer, { name: 'Test Buyer', email: 'buyer@example.test' });
  assert.equal(notification.items[0].name, 'Braided Wig');
  assert.equal(notification.items[0].qty, 2);
  assert.deepEqual(notification.items[0].variant, { color: 'Black', length: '24 inches', capSize: 'Medium' });
  assert.equal(notification.amount, 255);
  assert.equal(notification.amountMinor, 25500);
  assert.equal(notification.currency, 'GBP');
  assert.equal(notification.paymentStatus, 'paid');
  assert.equal(notification.paymentMethod, 'stripe');
  assert.equal(notification.read, false);
  assert.equal(Object.hasOwn(notification, 'eventId'), false);
  assert.equal(Object.hasOwn(notification, 'readBy'), false);
  // Public order endpoints use the default projection, which must not leak it.
  const publicOrder = await Order.findById(order._id).lean();
  assert.equal(Object.hasOwn(publicOrder, 'adminPaymentNotification'), false);
});

test('marking read is durable, idempotent, and private to the current admin', async () => {
  const order = await createNotification();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(`/${order._id}/read`, { method: 'PATCH' });
    assert.equal(response.status, 200);
    assert.equal(response.body.notification.read, true);
  }
  const ownList = await request();
  assert.equal(ownList.body.unreadCount, 0);
  assert.equal(ownList.body.notifications[0].read, true);
  const othersList = await request('', { token: tokenFor(secondAdmin) });
  assert.equal(othersList.body.unreadCount, 1);
  assert.equal(othersList.body.notifications[0].read, false);
  const stored = await Order.findById(order._id).select('+adminPaymentNotification').lean();
  assert.deepEqual(stored.adminPaymentNotification.readBy.map(String), [String(admin._id)]);
  assert.equal(stored.paymentStatus, 'paid');
});

test('pagination is stable across equal timestamps and does not expose Mongo query operators', async () => {
  const createdAt = new Date('2026-01-01T12:00:00Z');
  const orders = await Promise.all(Array.from({ length: 4 }, (_, index) => createNotification({ createdAt, reference: `REF-${index}` })));
  const first = await request('?limit=2');
  assert.equal(first.body.notifications.length, 2);
  assert.equal(first.body.unreadCount, 4);
  assert.ok(first.body.nextCursor);
  const second = await request(`?limit=2&cursor=${first.body.nextCursor}`);
  assert.equal(second.body.notifications.length, 2);
  assert.equal(second.body.nextCursor, null);
  assert.deepEqual([...first.body.notifications, ...second.body.notifications].map((row) => row.id),
    orders.map((order) => String(order._id)).sort().reverse());
  for (const query of ['?limit=0', '?limit=51', '?limit[]=2', '?limit=2.5', '?cursor=invalid', '?cursor[$gt]=1']) {
    assert.equal((await request(query)).status, 400);
  }
  assert.equal((await request('/bad-id/read', { method: 'PATCH' })).status, 400);
  assert.equal((await request(`/${new mongoose.Types.ObjectId()}/read`, { method: 'PATCH' })).status, 404);
});

test('all notification endpoints reject unauthenticated callers and non-admin role claims', async () => {
  const order = await createNotification();
  for (const [path, method] of [['', 'GET'], ['/stream', 'GET'], [`/${order._id}/read`, 'PATCH']]) {
    assert.equal((await request(path, { method, token: null })).status, 401);
    assert.equal((await request(path, { method, token: 'invalid' })).status, 401);
    assert.equal((await request(path, { method, token: tokenFor(customer) })).status, 403);
    assert.equal((await request(path, { method, token: tokenFor(admin, { expiresIn: -1 }) })).status, 401);
  }
  assert.equal((await request()).body.unreadCount, 1);
});

test('browser notification requests only accept configured frontend origins', async () => {
  assert.equal((await request('', { headers: { Origin: 'https://untrusted.test' } })).status, 403);
  assert.equal((await request('/stream', { headers: { Origin: 'https://untrusted.test' } })).status, 403);
  assert.equal((await request('', { headers: { Origin: process.env.CLIENT_URL } })).status, 200);
});

test('a bank-transfer self-report is never shown as a Stripe-confirmed notification', async () => {
  const order = await createNotification();
  await Order.updateOne({ _id: order._id }, {
    $set: { paymentMethod: 'bank_transfer', paymentStatus: 'awaiting_verification' },
    $unset: { adminPaymentNotification: '' },
  });
  const response = await request();
  assert.deepEqual(response.body.notifications, []);
  assert.equal(response.body.unreadCount, 0);
});

test('cookie-authenticated SSE updates after new payments and read changes without refresh', async () => {
  const stream = await openStream();
  try {
    assert.deepEqual((await eventFrom(stream, 'notifications')).notifications, []);
    const order = await createNotification();
    const paid = await eventFrom(stream, 'notifications');
    assert.equal(paid.notifications[0].orderId, String(order._id));
    assert.equal(paid.unreadCount, 1);
    await request(`/${order._id}/read`, { method: 'PATCH' });
    const read = await eventFrom(stream, 'notifications');
    assert.equal(read.notifications[0].read, true);
    assert.equal(read.unreadCount, 0);
  } finally { stream.controller.abort(); }
});

for (const [name, update] of [
  ['revoked session', { $inc: { authVersion: 1 } }],
  ['removed admin role', { $set: { role: 'customer' } }],
]) {
  test(`SSE closes after ${name}`, async () => {
    const stream = await openStream();
    try {
      await eventFrom(stream, 'notifications');
      await User.updateOne({ _id: admin._id }, update);
      const expired = await eventFrom(stream, 'auth-expired');
      assert.equal(expired.message, 'Please sign in again.');
      assert.equal((await stream.reader.read()).done, true);
    } finally { stream.controller.abort(); }
  });
}

test('SSE checks JWT expiry while an existing connection stays open', async () => {
  const stream = await openStream(tokenFor(admin, { expiresIn: 3 }));
  try {
    await eventFrom(stream, 'notifications');
    assert.equal((await eventFrom(stream, 'auth-expired')).message, 'Please sign in again.');
    assert.equal((await stream.reader.read()).done, true);
  } finally { stream.controller.abort(); }
});

test('notification read failures close SSE safely and reconnect recovers the unchanged payment', async () => {
  const order = await createNotification();
  const stream = await openStream();
  try {
    await eventFrom(stream, 'notifications');
    const failure = mock.method(Order, 'find', () => { throw new Error('Database unavailable'); });
    try {
      assert.equal((await eventFrom(stream, 'unavailable')).message, 'Reconnecting to notifications.');
      assert.equal((await stream.reader.read()).done, true);
    } finally { failure.mock.restore(); }
    const stored = await Order.findById(order._id).select('+adminPaymentNotification');
    assert.equal(stored.paymentStatus, 'paid');
    assert.equal(stored.adminPaymentNotification.readBy.length, 0);
    const restored = await openStream();
    try {
      const snapshot = await eventFrom(restored, 'notifications');
      assert.equal(snapshot.notifications[0].id, String(order._id));
      assert.equal(snapshot.unreadCount, 1);
    } finally { restored.controller.abort(); }
  } finally { stream.controller.abort(); }
});
