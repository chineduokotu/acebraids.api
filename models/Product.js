import mongoose from 'mongoose';

const variantSchema = new mongoose.Schema({
  label: { type: String, default: '' },
  color: { type: String, default: 'Natural Black (#1B)' },
  length: { type: String, default: '' },
  capSize: { type: String, default: 'Medium (Average)' },
  stock: { type: Number, default: 20 },
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
});

export const Product = mongoose.model('Product', productSchema);
