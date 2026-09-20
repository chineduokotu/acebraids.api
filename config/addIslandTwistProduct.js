import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ensureIslandTwistProduct } from './islandTwistProduct.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

try {
  // Connect to the configured catalogue directly: never silently add a product
  // to a temporary fallback database that disappears when this script exits.
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/acebeautybraids', {
    serverSelectionTimeoutMS: 5000,
  });
  const { product, created } = await ensureIslandTwistProduct();
  console.log(`${created ? 'Added' : 'Already present'}: ${product.name} (£${product.price})`);
  console.log(`Product route: /product/${product.slug}`);
} catch (error) {
  console.error('Could not add Island Twist. Check database access and the existing crochet category.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
