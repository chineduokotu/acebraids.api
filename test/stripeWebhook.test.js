import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';

// These are isolated, offline integration tests. Stripe's real SDK signs and
// verifies synthetic livemode:false events; no Stripe API calls or charges occur.
// This does not replace a Stripe test-mode Checkout + deployed webhook exercise.
const WEBHOOK_SECRET = 'whsec_isolated_webhook_test_signing_secret';
const API_SECRET = 'sk_test_isolated_webhook_no_network';
const JWT_SECRET = 'stripe-webhook-integration-test-jwt-secret-at-least-32-characters';
const ENV_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'JWT_SECRET', 'NODE_ENV', 'EMAIL_HOST_USER', 'EMAIL_HOST_PASSWORD'];
const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
const stripe = new Stripe(API_SECRET);
let database;
let httpServer;
let baseUrl;
let adminToken;
let counter = 0;

const nextId = prefix => `${prefix}_test_${++counter}`;

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function createOrder(overrides = {}) {
  return Order.create({
    guestInfo: {
      firstName: 'Ada', lastName: 'Buyer', email: 'ada@example.test',
      shippingAddress: { street: '1 Test Street', city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom' },
    },
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Boho braid', qty: 2, price: 50, variant: { color: 'Black', length: '28 inch' } }],
    subtotal: 100,
    shippingFee: 0,
    total: 100,
    currency: 'GBP',
    paymentMethod: 'stripe',
    paymentStatus: 'pending',
    orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'),
    paymentRef: nextId('ABB-PAY'),
    stripeCheckoutSessionId: nextId('cs'),
    stripeExpectedAmountMinor: 10000,
    stripeCurrency: 'gbp',
    stripeLivemode: false,
    ...overrides,
  });
}

function paymentEvent(order, type = 'checkout.session.completed', sessionOverrides = {}, eventOverrides = {}) {
  return {
    id: nextId('evt'), object: 'event', api_version: '2025-03-31.basil',
    created: Math.floor(Date.now() / 1000), livemode: false, type,
    data: { object: {
      id: order.stripeCheckoutSessionId,
      object: 'checkout.session', mode: 'payment', status: 'complete',
      livemode: false, payment_status: 'paid', payment_intent: nextId('pi'),
      amount_total: 10000, currency: 'gbp',
      metadata: { orderId: String(order._id) },
      client_reference_id: String(order._id),
      customer_details: { email: 'ada@example.test', name: 'Ada Buyer' },
      ...sessionOverrides,
    } },
    ...eventOverrides,
  };
}

function postEvent(event, { payload = JSON.stringify(event), signedPayload = payload, secret = WEBHOOK_SECRET, timestamp, signature, headers = {} } = {}) {
  const signedHeader = signature ?? stripe.webhooks.generateTestHeaderString({ payload: signedPayload, secret, ...(timestamp ? { timestamp } : {}) });
  return request('/api/payments/stripe/webhook', {
    method: 'POST', body: payload,
    headers: { 'Stripe-Signature': signedHeader, ...headers },
  });
}

const storedOrder = order => Order.collection.findOne({ _id: order._id });

async function assertUnpaid(order, expectedStatus = 'pending') {
  const stored = await storedOrder(order);
  assert.equal(stored.paymentStatus, expectedStatus);
  assert.equal(stored.paymentVerifiedAt, undefined);
  assert.equal(Boolean(stored.adminPaymentNotification), false, 'Unconfirmed payments must not create paid notifications');
  return stored;
}

async function assertPaid(order) {
  const stored = await storedOrder(order);
  assert.equal(stored.paymentStatus, 'paid');
  assert.equal(stored.orderStatus, 'processing');
  assert.ok(stored.paymentVerifiedAt instanceof Date);
  assert.ok(stored.adminPaymentNotification, 'Payment and persistent admin notification must be saved together');
  return stored;
}

before(async () => {
  process.env.STRIPE_SECRET_KEY = API_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.NODE_ENV = 'test';
  delete process.env.EMAIL_HOST_USER;
  delete process.env.EMAIL_HOST_PASSWORD;
  // Use MongoMemoryReplSet to support multi-document transactions in withInventoryTransaction
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ dbName: `stripe_webhook_test_${process.pid}` }] });
  await mongoose.connect(database.getUri());
  const { default: app } = await import('../app.js');
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const admin = await User.create({ name: 'Webhook Test Admin', email: 'webhook-admin@example.test', password: 'isolated test admin passphrase', role: 'admin' });
  adminToken = jwt.sign({ id: String(admin._id), authVersion: 0 }, JWT_SECRET, { expiresIn: '1h' });
  httpServer = app.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
}, { timeout: 120_000 });

beforeEach(async () => {
  await Order.deleteMany({});
  process.env.STRIPE_SECRET_KEY = API_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

after(async () => {
  if (httpServer) await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  if (database) await database.stop();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('a signed completed payment saves paid status and a persistent admin notification without a buyer return', async () => {
  const order = await createOrder();
  const response = await postEvent(paymentEvent(order));
  assert.equal(response.status, 200);
  const stored = await assertPaid(order);
  const notice = stored.adminPaymentNotification;
  assert.equal(notice.orderReference, order.trackingCode);
  assert.deepEqual(notice.customer, { name: 'Ada Buyer', email: 'ada@example.test' });
  assert.equal(notice.items.length, 1);
  assert.equal(notice.items[0].name, 'Boho braid');
  assert.equal(notice.items[0].qty, 2);
  assert.equal(notice.items[0].price, 50);
  assert.equal(notice.items[0].variant.color, 'Black');
  assert.equal(notice.amount, 100);
  assert.equal(notice.amountMinor, 10000);
  assert.equal(notice.currency, 'GBP');
  assert.equal(notice.paymentStatus, 'paid');
  assert.equal(notice.paymentMethod, 'stripe');
  assert.equal(await Order.countDocuments({ 'adminPaymentNotification': { $exists: true } }), 1);
  assert.equal(JSON.stringify(response.body).includes(WEBHOOK_SECRET), false);
});

test('missing webhook signatures cannot mark orders paid', async () => {
  const order = await createOrder();
  const response = await request('/api/payments/stripe/webhook', { method: 'POST', body: paymentEvent(order) });
  assert.equal(response.status, 400);
  await assertUnpaid(order);
});

for (const [name, options] of [
  ['forged signatures', { secret: 'whsec_wrong_secret' }],
  ['invalid signature headers', { signature: 'not-a-stripe-signature' }],
  ['expired signature timestamps', { timestamp: Math.floor(Date.now() / 1000) - 600 }],
]) {
  test(`${name} cannot mark orders paid`, async () => {
    const order = await createOrder();
    const response = await postEvent(paymentEvent(order), options);
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).includes(WEBHOOK_SECRET), false);
    await assertUnpaid(order);
  });
}

test('signature verification uses the exact raw body, accepting valid whitespace but rejecting changed bytes', async () => {
  const order = await createOrder();
  const event = paymentEvent(order);
  const payload = JSON.stringify(event, null, 2);
  const tampered = await postEvent(event, { payload, signedPayload: JSON.stringify(event) });
  assert.equal(tampered.status, 400);
  await assertUnpaid(order);
  const original = await postEvent(event, { payload });
  assert.equal(original.status, 200);
  await assertPaid(order);
});

test('a correctly signed malformed JSON body is rejected', async () => {
  const order = await createOrder();
  const response = await postEvent(null, { payload: '{"type": "checkout.session.completed",' });
  assert.equal(response.status, 400);
  await assertUnpaid(order);
});

test('non-JSON content cannot bypass raw request verification', async () => {
  const order = await createOrder();
  const response = await postEvent(paymentEvent(order), { headers: { 'Content-Type': 'text/plain' } });
  assert.equal(response.status, 400);
  await assertUnpaid(order);
});

test('a missing configured signing secret fails closed', async () => {
  const order = await createOrder();
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const response = await postEvent(paymentEvent(order));
  assert.ok(response.status >= 500 && response.status < 600);
  await assertUnpaid(order);
});

const mismatchedSessions = [
  ['underpayment', { amount_total: 9999 }],
  ['overpayment', { amount_total: 10001 }],
  ['noninteger amount', { amount_total: 10000.5 }],
  ['string amount', { amount_total: '10000' }],
  ['missing amount', { amount_total: undefined }],
  ['wrong currency', { currency: 'eur' }],
  ['missing currency', { currency: undefined }],
  ['different Checkout session', { id: 'cs_other_order' }],
  ['missing Checkout session', { id: undefined }],
  ['missing order metadata', { metadata: {} }],
  ['invalid order metadata', { metadata: { orderId: 'not-an-object-id' } }],
  ['unknown order metadata', { metadata: { orderId: new mongoose.Types.ObjectId().toString() } }],
  ['nonpayment Checkout mode', { mode: 'subscription' }],
  ['invalid Checkout object', { object: 'payment_intent' }],
  ['different client reference', { client_reference_id: 'another-order' }],
  ['live session for a test order', { livemode: true }],
];
for (const [name, fields] of mismatchedSessions) {
  test(`rejects ${name} without marking the order paid`, async () => {
    const order = await createOrder();
    const response = await postEvent(paymentEvent(order, 'checkout.session.completed', fields));
    assert.ok(response.status >= 400 && response.status < 500, `Expected validation rejection; received ${response.status}`);
    await assertUnpaid(order);
  });
}

test('metadata pointing at another existing order cannot pay either order', async () => {
  const order = await createOrder();
  const unrelated = await createOrder();
  const response = await postEvent(paymentEvent(order, 'checkout.session.completed', { metadata: { orderId: String(unrelated._id) } }));
  assert.ok(response.status >= 400 && response.status < 500);
  await assertUnpaid(order);
  await assertUnpaid(unrelated);
});

test('event livemode must match the persisted order mode', async () => {
  const order = await createOrder();
  const response = await postEvent(paymentEvent(order, 'checkout.session.completed', {}, { livemode: true }));
  assert.ok(response.status >= 400 && response.status < 500);
  await assertUnpaid(order);
});

test('legacy orders without a recorded Checkout session cannot be paid by metadata alone', async () => {
  const order = await createOrder();
  await Order.collection.updateOne({ _id: order._id }, { $unset: { stripeCheckoutSessionId: '', stripeExpectedAmountMinor: '', stripeCurrency: '', stripeLivemode: '' } });
  const response = await postEvent(paymentEvent(order));
  assert.ok(response.status >= 400 && response.status < 600);
  await assertUnpaid(order);
});

test('the signed amount must match both the immutable checkout amount and the order total', async () => {
  const order = await createOrder({ total: 50 });
  const response = await postEvent(paymentEvent(order));
  assert.equal(response.status, 400);
  await assertUnpaid(order);
});

test('the signed currency must match both the checkout currency and the order currency', async () => {
  const order = await createOrder({ currency: 'EUR' });
  const response = await postEvent(paymentEvent(order));
  assert.equal(response.status, 400);
  await assertUnpaid(order);
});

test('Stripe events cannot change a bank-transfer order', async () => {
  const order = await createOrder({ paymentMethod: 'bank_transfer' });
  const response = await postEvent(paymentEvent(order));
  assert.ok(response.status >= 400 && response.status < 500);
  assert.equal((await assertUnpaid(order)).paymentMethod, 'bank_transfer');
});

test('a completed but unpaid delayed payment waits for async payment success', async () => {
  const order = await createOrder();
  const completed = await postEvent(paymentEvent(order, 'checkout.session.completed', { payment_status: 'unpaid' }));
  assert.equal(completed.status, 200);
  assert.equal((await assertUnpaid(order)).stripePaymentState, 'processing');
  const succeeded = await postEvent(paymentEvent(order, 'checkout.session.async_payment_succeeded'));
  assert.equal(succeeded.status, 200);
  await assertPaid(order);
});

test('async payment failure remains unpaid and does not create a paid notification', async () => {
  const order = await createOrder();
  assert.equal((await postEvent(paymentEvent(order, 'checkout.session.completed', { payment_status: 'unpaid' }))).status, 200);
  const response = await postEvent(paymentEvent(order, 'checkout.session.async_payment_failed', { payment_status: 'unpaid' }));
  assert.equal(response.status, 200);
  assert.equal((await assertUnpaid(order, 'failed')).stripePaymentState, 'failed');
});

test('a late unpaid completed event cannot turn a failed payment back into processing', async () => {
  const order = await createOrder();
  assert.equal((await postEvent(paymentEvent(order, 'checkout.session.async_payment_failed', { payment_status: 'unpaid' }))).status, 200);
  assert.equal((await postEvent(paymentEvent(order, 'checkout.session.completed', { payment_status: 'unpaid' }))).status, 200);
  assert.equal((await assertUnpaid(order, 'failed')).stripePaymentState, 'failed');
});

test('an expired Checkout session remains unpaid and creates no paid notification', async () => {
  const order = await createOrder();
  const response = await postEvent(paymentEvent(order, 'checkout.session.expired', { payment_status: 'unpaid', status: 'expired' }));
  assert.equal(response.status, 200);
  assert.equal((await assertUnpaid(order, 'failed')).stripePaymentState, 'expired');
});

test('an async success event with an unpaid status cannot confirm payment', async () => {
  const order = await createOrder();
  const response = await postEvent(paymentEvent(order, 'checkout.session.async_payment_succeeded', { payment_status: 'unpaid' }));
  assert.ok(response.status >= 400 && response.status < 500);
  await assertUnpaid(order);
});

test('a success arriving before delayed completion stays paid when unpaid completion arrives later', async () => {
  const order = await createOrder();
  assert.equal((await postEvent(paymentEvent(order, 'checkout.session.async_payment_succeeded'))).status, 200);
  const paid = await assertPaid(order);
  assert.equal((await postEvent(paymentEvent(order, 'checkout.session.completed', { payment_status: 'unpaid' }))).status, 200);
  const after = await assertPaid(order);
  assert.deepEqual(after.adminPaymentNotification, paid.adminPaymentNotification);
  assert.deepEqual(after.paymentVerifiedAt, paid.paymentVerifiedAt);
});

test('delayed failure or expiry events never reverse a confirmed payment', async () => {
  const order = await createOrder();
  assert.equal((await postEvent(paymentEvent(order))).status, 200);
  const paid = await assertPaid(order);
  for (const type of ['checkout.session.async_payment_failed', 'checkout.session.expired']) {
    assert.equal((await postEvent(paymentEvent(order, type, { payment_status: 'unpaid' }))).status, 200);
    const current = await assertPaid(order);
    assert.deepEqual(current.adminPaymentNotification, paid.adminPaymentNotification);
    assert.deepEqual(current.paymentVerifiedAt, paid.paymentVerifiedAt);
  }
});

test('a paid success recovers a previously failed delayed payment', async () => {
  const order = await createOrder();
  assert.equal((await postEvent(paymentEvent(order, 'checkout.session.async_payment_failed', { payment_status: 'unpaid' }))).status, 200);
  await assertUnpaid(order, 'failed');
  assert.equal((await postEvent(paymentEvent(order, 'checkout.session.async_payment_succeeded'))).status, 200);
  await assertPaid(order);
});

test('retries of an identical event and different success events create exactly one stable notification', async () => {
  const order = await createOrder();
  const event = paymentEvent(order);
  assert.equal((await postEvent(event)).status, 200);
  const paid = await assertPaid(order);
  for (const duplicate of [event, paymentEvent(order), paymentEvent(order, 'checkout.session.async_payment_succeeded')]) {
    assert.equal((await postEvent(duplicate)).status, 200);
    const current = await assertPaid(order);
    assert.deepEqual(current.adminPaymentNotification, paid.adminPaymentNotification);
    assert.deepEqual(current.paymentVerifiedAt, paid.paymentVerifiedAt);
    assert.deepEqual(current.updatedAt, paid.updatedAt, 'Duplicate success must not write the order again');
  }
  assert.equal(await Order.countDocuments({ 'adminPaymentNotification': { $exists: true } }), 1);
});

test('simultaneous retries and independent success events make one atomic payment transition', async () => {
  const order = await createOrder();
  const event = paymentEvent(order);
  const responses = await Promise.all([
    postEvent(event), postEvent(event), postEvent(paymentEvent(order)),
    postEvent(paymentEvent(order, 'checkout.session.async_payment_succeeded')),
  ]);
  for (const response of responses) assert.equal(response.status, 200);
  const paid = await assertPaid(order);
  assert.equal(await Order.countDocuments({ 'adminPaymentNotification': { $exists: true } }), 1);
  assert.equal((await postEvent(event)).status, 200);
  assert.deepEqual((await assertPaid(order)).adminPaymentNotification, paid.adminPaymentNotification);
});

test('an atomic persistence failure returns retryable 5xx and a retry saves both payment and notification', async t => {
  const order = await createOrder();
  const event = paymentEvent(order);
  const failure = t.mock.method(Order, 'findOneAndUpdate', () => { throw new Error('simulated isolated database failure'); });
  const first = await postEvent(event);
  failure.mock.restore();
  assert.ok(first.status >= 500 && first.status < 600);
  assert.equal(JSON.stringify(first.body).includes('simulated isolated database failure'), false);
  await assertUnpaid(order);
  assert.equal((await postEvent(event)).status, 200);
  await assertPaid(order);
});

test('irrelevant signed events are acknowledged without changing any order', async () => {
  const order = await createOrder();
  assert.equal((await postEvent(paymentEvent(order, 'payment_intent.payment_failed'))).status, 200);
  await assertUnpaid(order);
});

test('public order and tracking endpoints never expose the embedded admin notification', async () => {
  const order = await createOrder();
  assert.equal((await postEvent(paymentEvent(order))).status, 200);
  await assertPaid(order);
  for (const path of [`/api/orders/${order._id}`, `/api/orders/track/${order.trackingCode}`, `/api/orders/${order._id}/payment-status`]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.body.paymentStatus, 'paid');
    assert.equal(Object.hasOwn(response.body, 'adminPaymentNotification'), false);
    assert.equal(JSON.stringify(response.body).includes(WEBHOOK_SECRET), false);
  }
});

test('a bank-transfer customer reporting money sent stays awaiting verification with no Stripe-paid notification', async () => {
  const order = await createOrder({ paymentMethod: 'bank_transfer' });
  const response = await request(`/api/payments/bank-transfer/${order._id}/confirm`, { method: 'POST', body: { customerPaymentNote: 'I have sent the money' } });
  assert.equal(response.status, 200);
  const stored = await assertUnpaid(order, 'awaiting_verification');
  assert.equal(stored.paymentMethod, 'bank_transfer');
  assert.ok(stored.paymentSubmittedAt instanceof Date);
});

test('the bank-transfer confirmation endpoint cannot update a Stripe order', async () => {
  const order = await createOrder();
  const response = await request(`/api/payments/bank-transfer/${order._id}/confirm`, { method: 'POST', body: { customerPaymentNote: 'I have sent the money' } });
  assert.equal(response.status, 400);
  await assertUnpaid(order);
});

for (const action of ['approve', 'reject']) {
  test(`manual bank-transfer ${action} cannot update a Stripe order, even for an admin`, async () => {
    const order = await createOrder({ paymentStatus: 'awaiting_verification' });
    const response = await request(`/api/orders/${order._id}/payment/${action}`, { method: 'PUT', token: adminToken, body: {} });
    assert.equal(response.status, 400);
    await assertUnpaid(order, 'awaiting_verification');
  });
}
