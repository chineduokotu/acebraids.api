import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: { type: String, required: true },
  slug: { type: String, default: '' },
  image: { type: String, default: '' },
  variant: {
    label: { type: String, default: '' },
    color: { type: String, default: '' },
    length: { type: String, default: '' },
    capSize: { type: String, default: '' },
    sku: { type: String, default: '' },
  },
  qty: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
});

const addressSchema = new mongoose.Schema({
  street: { type: String, required: true },
  apartment: { type: String, default: '' },
  city: { type: String, required: true },
  county: { type: String, default: '' },
  postalCode: { type: String, required: true },
  country: { type: String, required: true, default: 'United Kingdom' },
});

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  guestInfo: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: '' },
    shippingAddress: addressSchema,
  },
  items: [orderItemSchema],
  subtotal: {
    type: Number,
    required: true,
  },
  shippingFee: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'GBP',
  },
  paymentStatus: {
    type: String,
    enum: ['mock_paid', 'pending', 'failed'],
    default: 'pending',
  },
  paymentMethod: {
    type: String,
    default: 'mock',
  },
  paymentRef: {
    type: String,
    required: true,
  },
  orderStatus: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  trackingCode: {
    type: String,
    required: true,
    unique: true,
  },
  carrier: {
    type: String,
    default: 'Royal Mail 24 Tracked',
  },
  notes: {
    type: String,
    default: '',
  }
}, {
  timestamps: true,
});

export const Order = mongoose.model('Order', orderSchema);
