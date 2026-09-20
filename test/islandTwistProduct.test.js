import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { ensureIslandTwistProduct, ISLAND_TWIST_CATEGORY_SLUG, ISLAND_TWIST_SLUG } from '../config/islandTwistProduct.js';

let database, server, baseUrl, category, unrelated;

before(async () => {
  // Always isolate catalogue mutation tests from the configured shop database.
  database = await MongoMemoryServer.create({ instance: { dbName: `island_twist_test_${process.pid}` } });
  await mongoose.connect(database.getUri());
  await Promise.all([Category.init(), Product.init()]);
  const { default: app } = await import('../app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 120000 });

beforeEach(async () => {
  await Promise.all([Category.deleteMany({}), Product.deleteMany({})]);
  category = await Category.create({ name: 'Crochet extensions', slug: ISLAND_TWIST_CATEGORY_SLUG, image: '/uploads/existing.png', itemCount: 1 });
  unrelated = await Product.create({ name: 'Existing product', slug: 'existing-product', category: category._id, description: 'Preserve me', price: 75 });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (database) await database.stop();
});

test('adds only the authorised product and serves its real slug at £135', async () => {
  const { created, product } = await ensureIslandTwistProduct();
  assert.equal(created, true);
  assert.equal(product.price, 135);
  assert.equal(product.slug, ISLAND_TWIST_SLUG);
  assert.equal(product.details.length, 5);
  assert.equal(product.variants.length, 0);
  assert.equal(product.images.length, 0);
  assert.equal(product.videos[0].url, '/uploads/boho-crochet.mp4');
  assert.equal(product.reviewsCount, 0);
  assert.equal(await Product.countDocuments(), 2);
  assert.equal((await Category.findById(category._id)).itemCount, 2);
  assert.deepEqual((await Product.findById(unrelated._id)).toObject(), unrelated.toObject());

  const response = await fetch(`${baseUrl}/api/products/${ISLAND_TWIST_SLUG}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.name, 'Individual Boho Crochet Extension – Island Twist');
  assert.equal(body.price, 135);
  assert.equal(body.category.slug, ISLAND_TWIST_CATEGORY_SLUG);
});

test('reruns preserve existing edits and never duplicate the product or category count', async () => {
  const { product } = await ensureIslandTwistProduct();
  product.description = 'An edit from the product manager';
  await product.save();
  const expected = product.toObject();

  const repeated = await ensureIslandTwistProduct();
  assert.equal(repeated.created, false);
  assert.deepEqual(repeated.product.toObject(), expected);
  assert.equal(await Product.countDocuments({ slug: ISLAND_TWIST_SLUG }), 1);
  assert.equal((await Category.findById(category._id)).itemCount, 2);
});

test('a missing crochet category fails without replacing existing catalogue data', async () => {
  await Category.deleteOne({ _id: category._id });
  await assert.rejects(ensureIslandTwistProduct(), /category.*does not exist/);
  assert.equal(await Product.countDocuments(), 1);
  assert.deepEqual((await Product.findById(unrelated._id)).toObject(), unrelated.toObject());
});
