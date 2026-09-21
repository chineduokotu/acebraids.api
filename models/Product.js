import mongoose from 'mongoose';

const inventoryQuantity = (defaultValue) => ({
  type: Number,
  default: defaultValue,
  min: 0,
  validate: {
    validator: Number.isSafeInteger,
    message: '{PATH} must be a non-negative whole number.',
  },
});

const variantSchema = new mongoose.Schema({
  label: { type: String, default: '' },
  color: { type: String, default: 'Natural Black (#1B)' },
  length: { type: String, default: '' },
  capSize: { type: String, default: 'Medium (Average)' },
  stock: inventoryQuantity(0),
  lowStockThreshold: inventoryQuantity(5),
  sku: { type: String, default: '' },
  priceOverride: { type: Number },
});

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  alt: { type: String, default: 'AceBeautyBraids luxury hair product' },
  isMain: { type: Boolean, default: false },
});

const videoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  posterUrl: { type: String, default: '' },
  type: { type: String, default: 'video/mp4' },
});

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  details: {
    type: [String],
    default: [],
  },
  hairCareTips: {
    type: [String],
    default: [],
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  discountPrice: {
    type: Number,
    min: 0,
  },
  variants: [variantSchema],
  images: [imageSchema],
  videos: [videoSchema],
  isFeatured: {
    type: Boolean,
    default: false,
  },
  isNewArrival: {
    type: Boolean,
    default: false,
  },
  stock: inventoryQuantity(0),
  lowStockThreshold: inventoryQuantity(5),
  isSoldOut: {
    type: Boolean,
    default: false,
  },
  rating: {
    type: Number,
    default: 4.9,
  },
  reviewsCount: {
    type: Number,
    default: 18,
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

productSchema.virtual('totalStock').get(function () {
  if (this.variants && this.variants.length > 0) {
    return this.variants.reduce((acc, v) => acc + (Number.isFinite(v.stock) ? v.stock : 0), 0);
  }
  return Number.isFinite(this.stock) ? this.stock : 0;
});

productSchema.virtual('stockStatus').get(function () {
  const total = this.totalStock;
  const threshold = Number.isFinite(this.lowStockThreshold) ? this.lowStockThreshold : 5;
  if (this.isSoldOut || total === 0) return 'out_of_stock';
  if (total <= threshold) return 'low_stock';
  return 'in_stock';
});

// Homepage featured / new-arrival queries.
productSchema.index({ isFeatured: 1 });
productSchema.index({ isNewArrival: 1 });
// Shop category page: filter by category + availability.
productSchema.index({ category: 1, isSoldOut: 1 });

export const Product = mongoose.model('Product', productSchema);

