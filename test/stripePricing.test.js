import test, { before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Stripe from 'stripe';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { priceStripeOrder } from '../services/stripeOrderPricing.js';

// The only Stripe API boundary is replaced here. The HTTP app, pricing,
// database writes and signed webhook verification all run their real code.
const key = 'sk_test_isolated_checkout_no_network';
const secret = 'whsec_isolated_checkout_tests_only';
const keys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLIENT_URL', 'STRIPE_DYNAMIC_PAYMENT_METHODS'];
const previous = Object.fromEntries(keys.map((name) => [name, process.env[name]]));
let database, server, baseUrl, product, captured;
let sessionCount = 0;
const stripe = new Stripe(key);

const draft = (overrides = {}) => ({
  currency: 'GBP', shippingFee: 0,
  guestInfo: { firstName: 'Test', lastName: 'Buyer', email: 'buyer@example.test', shippingAddress: { street: '1 Test Street', city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom' } },
  items: [{ product: String(product._id), name: 'Spoofed product', qty: 1, price: 0.01, variant: { sku: 'BRAID-BLACK' } }],
  ...overrides,
});

before(async () => {
  process.env.STRIPE_SECRET_KEY = key;
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.CLIENT_URL = 'http://localhost:5173,https://checkout.example.test';
  delete process.env.STRIPE_DYNAMIC_PAYMENT_METHODS;
  mock.method(Object.getPrototypeOf(stripe.checkout.sessions), 'create', async (payload, options) => {
    captured = { payload, options };
    return { id: `cs_test_offline_${++sessionCount}`, url: 'https://checkout.stripe.com/test-fixture', livemode: false };
  });
  database = await MongoMemoryServer.create({ instance: { dbName: `stripe_pricing_test_${process.pid}` } });
  await mongoose.connect(database.getUri());
  const { default: app } = await import('../app.js');
  await Promise.all([Product.init(), Order.init()]);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });

beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), Order.deleteMany({})]);
  product = await Product.create({ name: 'Braided Wig', slug: 'test-braid', category: new mongoose.Types.ObjectId(), description: 'Test product', price: 60, discountPrice: 50,
    variants: [{ sku: 'BRAID-BLACK', color: 'Black', length: '24', capSize: 'Medium', stock: 5 }] });
  captured = null;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
  mock.restoreAll();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test('server catalogue prices and shipping replace tampered browser amounts', async () => {
  const priced = await priceStripeOrder(draft());
  assert.equal(priced.items[0].name, 'Braided Wig');
  assert.equal(priced.items[0].price, 50);
  assert.equal(priced.shippingFee, 5.99);
  assert.equal(priced.stripeExpectedAmountMinor, 5599);
  const euro = await priceStripeOrder(draft({ currency: 'EUR' }));
  assert.equal(euro.items[0].price, 59);
  assert.equal(euro.shippingFee, 7.07);
  assert.equal(euro.total, 66.07);
});

test('invalid quantities, currencies, options and combined stock cannot create checkout', async () => {
  for (const invalid of [
    draft({ currency: 'USD' }),
    draft({ items: [{ ...draft().items[0], qty: 0.5 }] }),
    draft({ items: [{ ...draft().items[0], qty: -1 }] }),
    draft({ items: [{ ...draft().items[0], variant: { sku: 'missing-option' } }] }),
    draft({ items: [{ ...draft().items[0], qty: 3 }, { ...draft().items[0], qty: 3 }] }),
  ]) await assert.rejects(priceStripeOrder(invalid), (error) => error.status === 400);
});

test('checkout binds order ID, exact amount and session before releasing its URL; a signed payment confirms that order', async () => {
  const response = await fetch(`${baseUrl}/api/payments/stripe/checkout-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://checkout.example.test' }, body: JSON.stringify({ orderDraft: draft() }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  const order = await Order.findById(body.order._id);
  assert.equal(order.stripeCheckoutSessionId, body.sessionId);
  assert.equal(order.stripeExpectedAmountMinor, 5599);
  assert.equal(order.stripeLivemode, false);
  assert.equal(captured.payload.line_items[0].price_data.unit_amount, 5599);
  assert.equal(captured.payload.metadata.orderId, String(order._id));
  assert.equal(captured.payload.client_reference_id, String(order._id));
  assert.match(captured.payload.success_url, /^https:\/\/checkout.example.test\/order-confirmation\//);
  assert.equal(captured.options.idempotencyKey, `checkout-order-${order._id}`);
  assert.deepEqual(captured.payload.payment_method_types, ['card']);
  const payload = JSON.stringify({ id: 'evt_test_checkout_paid', type: 'checkout.session.completed', livemode: false, data: { object: { object: 'checkout.session', id: body.sessionId, mode: 'payment', livemode: false, payment_status: 'paid', amount_total: 5599, currency: 'gbp', metadata: { orderId: String(order._id) } } } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const webhook = await fetch(`${baseUrl}/api/payments/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload });
  assert.equal(webhook.status, 200);
  const confirmed = await Order.findById(order._id).select('+adminPaymentNotification');
  assert.equal(confirmed.paymentStatus, 'paid');
  assert.equal(confirmed.adminPaymentNotification.amount, 55.99);
});

test('untrusted checkout origins never receive a hosted checkout session', async () => {
  const response = await fetch(`${baseUrl}/api/payments/stripe/checkout-session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ orderDraft: draft() }) });
  assert.equal(response.status, 403);
  assert.equal(captured, null);
  assert.equal(await Order.countDocuments(), 0);
});
