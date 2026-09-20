import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';

export const ISLAND_TWIST_SLUG = 'individual-boho-crochet-extension-island-twist';
export const ISLAND_TWIST_CATEGORY_SLUG = 'ready-to-install-boho-crochet-extensions';

export const createIslandTwistProductData = (category) => ({
  name: 'Individual Boho Crochet Extension – Island Twist',
  slug: ISLAND_TWIST_SLUG,
  category,
  description: 'Elevate your look with our Individual Boho Crochet Extensions, designed to give you a beautiful, effortless Island Twist style.\n\nPerfect for creating a gorgeous boho-inspired look with less styling time and maximum versatility.',
  details: [
    'Length: 30 inches',
    'Colour: Black',
    'Style: Island Twist / Single Braids',
    'Adjustable Length: The extensions can be cut and customised to your desired length.',
    'Reusable: Each extension can be carefully reused up to 3 times, making it a great choice for versatile styling.',
  ],
  price: 135,
  // This single-option product does not have a confirmed inventory quantity.
  // Empty variants use the catalogue's existing untracked-inventory behavior.
  variants: [],
  images: [],
  videos: [{ url: '/uploads/boho-crochet.mp4', type: 'video/mp4' }],
  rating: 0,
  reviewsCount: 0,
});

// Add this authorised product to an existing catalogue without reseeding or
// overwriting subsequent edits made in the product manager.
export const ensureIslandTwistProduct = async () => {
  const existing = await Product.findOne({ slug: ISLAND_TWIST_SLUG });
  if (existing) return { product: existing, created: false };

  const category = await Category.findOne({ slug: ISLAND_TWIST_CATEGORY_SLUG });
  if (!category) {
    throw new Error(`Cannot add Island Twist: category "${ISLAND_TWIST_CATEGORY_SLUG}" does not exist.`);
  }

  const now = new Date();
  const result = await Product.updateOne(
    { slug: ISLAND_TWIST_SLUG },
    { $setOnInsert: { ...createIslandTwistProductData(category._id), createdAt: now, updatedAt: now } },
    { upsert: true, runValidators: true, timestamps: false },
  );

  if (result.upsertedCount) {
    await Category.updateOne({ _id: category._id }, { $inc: { itemCount: 1 } });
  }

  return {
    product: await Product.findOne({ slug: ISLAND_TWIST_SLUG }),
    created: result.upsertedCount === 1,
  };
};
