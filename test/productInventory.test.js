import test, { after, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { InventoryLog } from '../models/InventoryLog.js';
import { User } from '../models/User.js';
import productRoutes from '../routes/productRoutes.js';

const secret = 'product-inventory-tests-only-secret-at-least-32-characters';
const originalSecret = process.env.JWT_SECRET;
let database, server, baseUrl, category, admin, token;

const draft = (overrides = {}) => ({
  name: 'Inventory test braid', slug: 'inventory-test-braid', category: String(category._id),
  description: 'Inventory fixture', price: 80, stock: 4, ...overrides,
});
const snapshot = (product) => ({ stock: product.stock, variants: product.variants.map(({ _id, stock }) => ({ _id, stock })) });

async function request(path, method, body, auth = token) {
  const response = await fetch(`${baseUrl}/api/products${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  process.env.JWT_SECRET = secret;
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ dbName: `product_inventory_${process.pid}` }] });
  await mongoose.connect(database.getUri());
  await Promise.all([Product.init(), Category.init(), InventoryLog.init(), User.init()]);
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });

beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), Category.deleteMany({}), InventoryLog.deleteMany({}), User.deleteMany({})]);
  category = await Category.create({ name: 'Braids', slug: 'braids', image: '/test.png', itemCount: 0 });
  admin = await User.create({ name: 'Inventory admin', email: 'inventory-admin@example.test', password: 'test password', role: 'admin' });
  token = jwt.sign({ id: String(admin._id), authVersion: 0 }, secret, { expiresIn: '1h' });
});

after(async () => {
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});

test('models default new inventory to zero and serialize product and variant stock status', () => {
  const product = new Product(draft({ stock: undefined, variants: [{ label: 'Black' }] }));
  assert.equal(product.stock, 0);
  assert.equal(product.variants[0].stock, 0);
  assert.equal(product.variants[0].lowStockThreshold, 5);
  assert.equal(product.toJSON().stockStatus, 'out_of_stock');
  product.variants[0].stock = 3;
  assert.equal(product.toJSON().totalStock, 3);
  assert.equal(product.toJSON().stockStatus, 'low_stock');
  product.variants.push({ label: 'Brown', stock: 4 });
  assert.equal(product.toJSON().totalStock, 7);
  assert.equal(product.toJSON().stockStatus, 'in_stock');
  product.isSoldOut = true;
  assert.equal(product.toJSON().stockStatus, 'out_of_stock');
  for (const fields of [{ stock: -1 }, { stock: 0.5 }, { lowStockThreshold: 2.5 }, { variants: [{ stock: 1.5 }] }, { variants: [{ lowStockThreshold: -1 }] }]) {
    assert.ok(new Product(draft(fields)).validateSync());
  }
});

test('creation saves stock and thresholds and records opening inventory with the acting admin', async () => {
  const result = await request('', 'POST', draft({ stock: 8, lowStockThreshold: 2 }));
  assert.equal(result.status, 201);
  assert.equal(result.body.stock, 8);
  assert.equal(result.body.lowStockThreshold, 2);
  assert.equal(result.body.totalStock, 8);
  assert.equal(result.body.stockStatus, 'in_stock');
  const log = await InventoryLog.findOne({ product: result.body._id });
  assert.equal(log.previousStock, 0);
  assert.equal(log.newStock, 8);
  assert.equal(log.quantityDelta, 8);
  assert.equal(String(log.performedBy), String(admin._id));
  assert.equal((await Category.findById(category._id)).itemCount, 1);
});

test('full edits audit each variant change and removal while preserving identifiers', async () => {
  const product = await Product.create(draft({ stock: 0, variants: [{ label: 'Black', sku: 'BLACK', stock: 8 }, { label: 'Brown', stock: 3 }] }));
  const result = await request(`/${product._id}`, 'PUT', {
    inventorySnapshot: snapshot(product),
    lowStockThreshold: 2,
    variants: [{ _id: String(product.variants[0]._id), stock: 4, lowStockThreshold: 1 }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.totalStock, 4);
  assert.equal(result.body.lowStockThreshold, 2);
  assert.equal(result.body.variants[0].sku, 'BLACK');
  assert.equal(result.body.variants[0].lowStockThreshold, 1);
  assert.equal(result.body.variants[0]._id, String(product.variants[0]._id));
  const logs = await InventoryLog.find({ product: product._id });
  assert.equal(logs.length, 2);
  const remainingLog = logs.find((log) => String(log.variantId) === String(product.variants[0]._id));
  assert.equal(remainingLog.quantityDelta, -4);
  assert.equal(remainingLog.previousStock, 8);
  assert.equal(remainingLog.newStock, 4);
  assert.equal(remainingLog.toJSON().sku, 'BLACK');
  const removedLog = logs.find((log) => String(log.variantId) === String(product.variants[1]._id));
  assert.equal(removedLog.quantityDelta, -3);
  assert.equal(removedLog.newStock, 0);
});

test('base inventory edits are audited, metadata edits create no stock movements', async () => {
  const product = await Product.create(draft());
  const edited = await request(`/${product._id}`, 'PUT', { stock: 2, lowStockThreshold: 1 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.stock, 2);
  const unchanged = await request(`/${product._id}`, 'PUT', { name: 'Renamed braid', lowStockThreshold: 3 });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.stockStatus, 'low_stock');
  assert.equal(await InventoryLog.countDocuments({ product: product._id }), 1);
  const log = await InventoryLog.findOne({ product: product._id });
  assert.equal(log.previousStock, 4);
  assert.equal(log.quantityDelta, -2);
});

test('stale full product inventory edits cannot overwrite a subsequent purchase', async () => {
  const product = await Product.create(draft({ variants: [{ label: 'Black', stock: 8 }] }));
  await Product.updateOne({ _id: product._id }, { $inc: { 'variants.0.stock': -1 } });
  const result = await request(`/${product._id}`, 'PUT', { inventorySnapshot: snapshot(product), variants: product.variants.toObject() });
  assert.equal(result.status, 409);
  assert.match(result.body.message, /Stock changed/);
  assert.equal((await Product.findById(product._id)).variants[0].stock, 7);
  assert.equal(await InventoryLog.countDocuments(), 0);
});

test('quick stock updates require an administrator and validate whole, non-negative inventory', async () => {
  const product = await Product.create(draft());
  assert.equal((await request(`/${product._id}/stock`, 'PATCH', { stock: 6 }, null)).status, 401);
  const customer = await User.create({ name: 'Customer', email: 'inventory-customer@example.test', password: 'test password' });
  const customerToken = jwt.sign({ id: String(customer._id) }, secret, { expiresIn: '1h' });
  assert.equal((await request(`/${product._id}/stock`, 'PATCH', { stock: 6 }, customerToken)).status, 403);
  for (const body of [{ stock: -1 }, { stock: 1.5 }, { stock: null }, { stock: '' }, { stock: true }, { lowStockThreshold: 0.5 }, {}]) {
    const result = await request(`/${product._id}/stock`, 'PATCH', body);
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  assert.equal((await Product.findById(product._id)).stock, 4);
  assert.equal(await InventoryLog.countDocuments(), 0);
});

test('quick stock updates address the selected variant and log the exact stock delta', async () => {
  const product = await Product.create(draft({ stock: 0, variants: [{ label: 'Black', stock: 8 }, { label: 'Brown', stock: 3 }] }));
  assert.equal((await request(`/${product._id}/stock`, 'PATCH', { stock: 2 })).status, 400);
  const result = await request(`/${product._id}/stock`, 'PATCH', {
    variantId: String(product.variants[1]._id), stock: 0, expectedStock: 3, lowStockThreshold: 2, notes: 'Stock count',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.variants[0].stock, 8);
  assert.equal(result.body.variants[1].stock, 0);
  assert.equal(result.body.variants[1].lowStockThreshold, 2);
  const log = await InventoryLog.findOne({ product: product._id });
  assert.equal(String(log.variantId), String(product.variants[1]._id));
  assert.equal(log.previousStock, 3);
  assert.equal(log.newStock, 0);
  assert.equal(log.quantityDelta, -3);
  assert.equal(log.notes, 'Stock count');
});

test('concurrent quick adjustments with the same snapshot cannot overwrite one another', async () => {
  const product = await Product.create(draft());
  const results = await Promise.all([
    request(`/${product._id}/stock`, 'PATCH', { stock: 6, expectedStock: 4 }),
    request(`/${product._id}/stock`, 'PATCH', { stock: 8, expectedStock: 4 }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const updated = await Product.findById(product._id);
  const logs = await InventoryLog.find({ product: product._id });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].previousStock, 4);
  assert.equal(logs[0].newStock, updated.stock);
  assert.equal(logs[0].quantityDelta, updated.stock - 4);
});
