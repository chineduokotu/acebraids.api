import test, { before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { Category } from '../models/Category.js';
import { InventoryLog } from '../models/InventoryLog.js';
import { User } from '../models/User.js';
import { applyStripeCheckoutEvent } from '../services/stripeWebhook.js';
import { deductOrderStock, restoreOrderStock, validateItemsStock } from '../services/inventoryService.js';
import { priceStripeOrder } from '../services/stripeOrderPricing.js';
import { approvePayment, updateOrderStatus } from '../controllers/orderController.js';

let database;
let category;
let admin;
let counter = 0;

const nextId = (prefix) => `${prefix}_inv_${++counter}`;

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(data) { this.body = data; return this; },
});

before(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_secret_key';
  database = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ dbName: `inventory_integration_${process.pid}` }],
  });
  await mongoose.connect(database.getUri());
  await Promise.all([
    Product.init(),
    Order.init(),
    Category.init(),
    InventoryLog.init(),
    User.init(),
  ]);
}, { timeout: 120_000 });

beforeEach(async () => {
  await Promise.all([
    Product.deleteMany({}),
    Order.deleteMany({}),
    Category.deleteMany({}),
    InventoryLog.deleteMany({}),
    User.deleteMany({}),
  ]);
  category = await Category.create({ name: 'Braids', slug: 'braids', image: '/test.png', itemCount: 0 });
  admin = await User.create({ name: 'Inventory Admin', email: 'admin@example.test', password: 'password', role: 'admin' });
});

after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  if (database) await database.stop();
});

test('variant-level stock deduction and audit logging on confirmed Stripe webhook', async () => {
  const product = await Product.create({
    name: 'Island Twist Wig',
    slug: 'island-twist-wig',
    category: category._id,
    description: 'Luxury braided wig',
    price: 120,
    stock: 0,
    variants: [
      { label: 'Natural Black 24"', color: 'Natural Black', length: '24"', stock: 5, lowStockThreshold: 2, sku: 'IT-BLK-24' },
      { label: 'Ombre Brown 30"', color: 'Ombre Brown', length: '30"', stock: 3, lowStockThreshold: 2, sku: 'IT-BRN-30' },
    ],
  });

  const selectedVariant = product.variants[0];
  const order = await Order.create({
    guestInfo: {
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test',
      shippingAddress: { street: '10 High St', city: 'London', postalCode: 'E1 6AN', country: 'United Kingdom' },
    },
    items: [{
      product: product._id,
      name: product.name,
      qty: 2,
      price: 120,
      variant: {
        _id: selectedVariant._id,
        label: selectedVariant.label,
        color: selectedVariant.color,
        length: selectedVariant.length,
        sku: selectedVariant.sku,
      },
    }],
    subtotal: 240,
    shippingFee: 0,
    total: 240,
    currency: 'GBP',
    paymentMethod: 'stripe',
    paymentStatus: 'pending',
    orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'),
    paymentRef: nextId('ABB-PAY'),
    stripeCheckoutSessionId: nextId('cs'),
    stripeExpectedAmountMinor: 24000,
    stripeCurrency: 'gbp',
    stripeLivemode: false,
  });

  const event = {
    id: nextId('evt'),
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: order.stripeCheckoutSessionId,
        object: 'checkout.session',
        mode: 'payment',
        livemode: false,
        payment_status: 'paid',
        payment_intent: nextId('pi'),
        amount_total: 24000,
        currency: 'gbp',
        metadata: { orderId: String(order._id) },
        client_reference_id: String(order._id),
      },
    },
  };

  const result = await applyStripeCheckoutEvent(event);
  assert.equal(result.updated, true);

  const updatedProduct = await Product.findById(product._id);
  const updatedVariant = updatedProduct.variants.id(selectedVariant._id);
  assert.equal(updatedVariant.stock, 3, 'Variant stock should decrease by ordered quantity (5 - 2 = 3)');
  assert.equal(updatedProduct.variants[1].stock, 3, 'Other variant stock should remain unchanged');

  const updatedOrder = await Order.findById(order._id);
  assert.equal(updatedOrder.paymentStatus, 'paid');
  assert.equal(updatedOrder.inventoryState, 'deducted');
  assert.equal(updatedOrder.stockAllocations.length, 1);
  assert.equal(updatedOrder.stockAllocations[0].qty, 2);

  const log = await InventoryLog.findOne({ product: product._id, variantId: selectedVariant._id });
  assert.ok(log, 'InventoryLog entry must be recorded');
  assert.equal(log.changeType, 'customer_purchase');
  assert.equal(log.quantityDelta, -2);
  assert.equal(log.previousStock, 5);
  assert.equal(log.newStock, 3);
  assert.equal(String(log.order), String(order._id));
});

test('base product-level stock deduction when product has no variants', async () => {
  const product = await Product.create({
    name: 'Single Braid Pack',
    slug: 'single-braid-pack',
    category: category._id,
    description: 'Standard braiding pack',
    price: 30,
    stock: 10,
    variants: [],
  });

  const order = await Order.create({
    guestInfo: {
      firstName: 'Alice', lastName: 'Smith', email: 'alice@example.test',
      shippingAddress: { street: '5 Oxford St', city: 'London', postalCode: 'W1D 1BS', country: 'United Kingdom' },
    },
    items: [{
      product: product._id,
      name: product.name,
      qty: 4,
      price: 30,
      variant: {},
    }],
    subtotal: 120,
    shippingFee: 0,
    total: 120,
    currency: 'GBP',
    paymentMethod: 'stripe',
    paymentStatus: 'pending',
    orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'),
    paymentRef: nextId('ABB-PAY'),
    stripeCheckoutSessionId: nextId('cs'),
    stripeExpectedAmountMinor: 12000,
    stripeCurrency: 'gbp',
    stripeLivemode: false,
  });

  const event = {
    id: nextId('evt'),
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: order.stripeCheckoutSessionId,
        object: 'checkout.session',
        mode: 'payment',
        livemode: false,
        payment_status: 'paid',
        payment_intent: nextId('pi'),
        amount_total: 12000,
        currency: 'gbp',
        metadata: { orderId: String(order._id) },
        client_reference_id: String(order._id),
      },
    },
  };

  const result = await applyStripeCheckoutEvent(event);
  assert.equal(result.updated, true);

  const updatedProduct = await Product.findById(product._id);
  assert.equal(updatedProduct.stock, 6, 'Product stock should decrease by 4 (10 - 4 = 6)');

  const log = await InventoryLog.findOne({ product: product._id });
  assert.equal(log.changeType, 'customer_purchase');
  assert.equal(log.quantityDelta, -4);
  assert.equal(log.previousStock, 10);
  assert.equal(log.newStock, 6);
});

test('graceful inventoryState: unavailable if stock was depleted prior to Stripe webhook', async () => {
  const product = await Product.create({
    name: 'Limited Edition Wig',
    slug: 'limited-wig',
    category: category._id,
    description: 'Rare piece',
    price: 200,
    stock: 1,
    variants: [],
  });

  const order = await Order.create({
    guestInfo: {
      firstName: 'Bob', lastName: 'Taylor', email: 'bob@example.test',
      shippingAddress: { street: '22 Queen St', city: 'London', postalCode: 'EC4R 1BB', country: 'United Kingdom' },
    },
    items: [{ product: product._id, name: product.name, qty: 1, price: 200, variant: {} }],
    subtotal: 200, shippingFee: 0, total: 200, currency: 'GBP',
    paymentMethod: 'stripe', paymentStatus: 'pending', orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'), paymentRef: nextId('ABB-PAY'),
    stripeCheckoutSessionId: nextId('cs'), stripeExpectedAmountMinor: 20000,
    stripeCurrency: 'gbp', stripeLivemode: false,
  });

  // Deplete stock before webhook arrives
  await Product.updateOne({ _id: product._id }, { $set: { stock: 0 } });

  const event = {
    id: nextId('evt'),
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: order.stripeCheckoutSessionId,
        object: 'checkout.session',
        mode: 'payment',
        livemode: false,
        payment_status: 'paid',
        payment_intent: nextId('pi'),
        amount_total: 20000,
        currency: 'gbp',
        metadata: { orderId: String(order._id) },
        client_reference_id: String(order._id),
      },
    },
  };

  const result = await applyStripeCheckoutEvent(event);
  assert.equal(result.updated, true);

  const updatedOrder = await Order.findById(order._id);
  assert.equal(updatedOrder.paymentStatus, 'paid', 'Payment write is preserved');
  assert.equal(updatedOrder.inventoryState, 'unavailable', 'Order is flagged as inventory unavailable');
  assert.ok(updatedOrder.inventoryError.length > 0, 'Error message is stored for admin review');

  const refreshedProduct = await Product.findById(product._id);
  assert.equal(refreshedProduct.stock, 0, 'Stock must not drop below zero');
});

test('bank transfer payment approval atomically deducts stock and logs admin ID', async () => {
  const product = await Product.create({
    name: 'French Curl Braids',
    slug: 'french-curl-braids',
    category: category._id,
    description: 'French curl extensions',
    price: 85,
    stock: 0,
    variants: [{ label: '1B Black', color: '1B Black', stock: 8, lowStockThreshold: 3, sku: 'FC-1B' }],
  });

  const order = await Order.create({
    guestInfo: {
      firstName: 'Sarah', lastName: 'Connor', email: 'sarah@example.test',
      shippingAddress: { street: '1 Market Rd', city: 'London', postalCode: 'N7 9PW', country: 'United Kingdom' },
    },
    items: [{
      product: product._id,
      name: product.name,
      qty: 3,
      price: 85,
      variant: { _id: product.variants[0]._id, label: '1B Black', color: '1B Black', sku: 'FC-1B' },
    }],
    subtotal: 255, shippingFee: 0, total: 255, currency: 'GBP',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'awaiting_verification',
    orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'),
    paymentRef: nextId('ABB-PAY'),
  });

  const req = { params: { id: String(order._id) }, user: { _id: admin._id } };
  const res = response();
  await approvePayment(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.paymentStatus, 'paid');
  assert.equal(res.body.inventoryState, 'deducted');

  const updatedProduct = await Product.findById(product._id);
  assert.equal(updatedProduct.variants[0].stock, 5, 'Stock should be deducted from 8 to 5');

  const log = await InventoryLog.findOne({ product: product._id, order: order._id });
  assert.ok(log);
  assert.equal(log.changeType, 'customer_purchase');
  assert.equal(log.quantityDelta, -3);
  assert.equal(String(log.performedBy), String(admin._id));
});

test('cancelling a paid order restores deducted stock and logs order_cancellation', async () => {
  const product = await Product.create({
    name: 'Knotless Braid Wig',
    slug: 'knotless-braid-wig',
    category: category._id,
    description: 'Knotless styling',
    price: 150,
    stock: 6,
    variants: [],
  });

  const order = await Order.create({
    guestInfo: {
      firstName: 'Clara', lastName: 'Oswald', email: 'clara@example.test',
      shippingAddress: { street: '7 Green Lane', city: 'London', postalCode: 'NW1 4NP', country: 'United Kingdom' },
    },
    items: [{ product: product._id, name: product.name, qty: 2, price: 150, variant: {} }],
    subtotal: 300, shippingFee: 0, total: 300, currency: 'GBP',
    paymentMethod: 'bank_transfer',
    paymentStatus: 'awaiting_verification',
    orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'),
    paymentRef: nextId('ABB-PAY'),
  });

  // Deduct stock first
  await deductOrderStock(order, { reason: 'customer_purchase', performedBy: admin._id });
  let currentProduct = await Product.findById(product._id);
  assert.equal(currentProduct.stock, 4);

  // Now cancel the order via orderController
  const req = { params: { id: String(order._id) }, body: { orderStatus: 'cancelled' }, user: { _id: admin._id } };
  const res = response();
  await updateOrderStatus(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.orderStatus, 'cancelled');
  assert.equal(res.body.inventoryState, 'restored');

  currentProduct = await Product.findById(product._id);
  assert.equal(currentProduct.stock, 6, 'Stock should be restored back to 6');

  const restoreLog = await InventoryLog.findOne({ product: product._id, changeType: 'order_cancellation' });
  assert.ok(restoreLog);
  assert.equal(restoreLog.quantityDelta, 2);
  assert.equal(restoreLog.previousStock, 4);
  assert.equal(restoreLog.newStock, 6);
});

test('concurrency: overselling prevention blocks purchases exceeding available inventory', async () => {
  const product = await Product.create({
    name: 'Last Unit Twist',
    slug: 'last-unit-twist',
    category: category._id,
    description: 'Limited stock',
    price: 100,
    stock: 3,
    variants: [],
  });

  const orderA = await Order.create({
    guestInfo: { firstName: 'User', lastName: 'One', email: 'one@example.test', shippingAddress: { street: '1 A Rd', city: 'London', postalCode: 'W1', country: 'United Kingdom' } },
    items: [{ product: product._id, name: product.name, qty: 2, price: 100, variant: {} }],
    subtotal: 200, shippingFee: 0, total: 200, currency: 'GBP',
    paymentMethod: 'stripe', paymentStatus: 'pending', orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'), paymentRef: nextId('ABB-PAY'),
  });

  const orderB = await Order.create({
    guestInfo: { firstName: 'User', lastName: 'Two', email: 'two@example.test', shippingAddress: { street: '2 B Rd', city: 'London', postalCode: 'W2', country: 'United Kingdom' } },
    items: [{ product: product._id, name: product.name, qty: 2, price: 100, variant: {} }],
    subtotal: 200, shippingFee: 0, total: 200, currency: 'GBP',
    paymentMethod: 'stripe', paymentStatus: 'pending', orderStatus: 'pending',
    trackingCode: nextId('ABB-UK'), paymentRef: nextId('ABB-PAY'),
  });

  // Both orders require 2 units, but only 3 exist. Concurrently attempting both:
  const results = await Promise.allSettled([
    deductOrderStock(orderA),
    deductOrderStock(orderB),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Only one order can claim the remaining stock');
  assert.equal(rejected.length, 1, 'The other order must be rejected due to insufficient stock');

  const finalProduct = await Product.findById(product._id);
  assert.equal(finalProduct.stock, 1, 'Final stock should be 1 (3 - 2 = 1), never negative');
});

test('pricing validation blocks draft checkout when items are out of stock', async () => {
  const inStock = await Product.create({
    name: 'Available Product',
    slug: 'available-product',
    category: category._id,
    description: 'In stock item',
    price: 50,
    stock: 2,
    variants: [],
  });

  const soldOut = await Product.create({
    name: 'Depleted Product',
    slug: 'depleted-product',
    category: category._id,
    description: 'Out of stock item',
    price: 50,
    stock: 0,
    variants: [],
  });

  // Attempt to buy more than available (3 units when 2 in stock)
  await assert.rejects(
    priceStripeOrder({
      currency: 'GBP',
      guestInfo: { firstName: 'Test', lastName: 'User', email: 'test@example.test', shippingAddress: { street: 'Street', city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom' } },
      items: [{ product: String(inStock._id), qty: 3 }],
    }),
    /Only 2 units of "Available Product" are currently available/
  );

  // Attempt to buy 1 unit of sold out product
  await assert.rejects(
    priceStripeOrder({
      currency: 'GBP',
      guestInfo: { firstName: 'Test', lastName: 'User', email: 'test@example.test', shippingAddress: { street: 'Street', city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom' } },
      items: [{ product: String(soldOut._id), qty: 1 }],
    }),
    /"Depleted Product" is currently out of stock/
  );
});
