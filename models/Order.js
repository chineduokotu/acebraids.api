import mongoose from 'mongoose';
import { adminPaymentNotificationSchema } from './AdminPaymentNotification.js';

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
    _id: { type: mongoose.Schema.Types.ObjectId },
    label: { type: String, default: '' },
    color: { type: String, default: '' },
    length: { type: String, default: '' },
    capSize: { type: String, default: '' },
    sku: { type: String, default: '' },
  },
  qty: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
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
    enum: ['mock_paid', 'pending', 'awaiting_verification', 'paid', 'rejected', 'failed'],
    default: 'pending',
  },
  paymentMethod: {
    type: String,
    default: 'bank_transfer',
  },
  stripeCheckoutSessionId: { type: String },
  stripeExpectedAmountMinor: { type: Number, min: 0, validate: Number.isSafeInteger },
  stripeCurrency: { type: String, enum: ['gbp', 'eur'] },
  stripeLivemode: { type: Boolean },
  stripePaymentIntentId: { type: String },
  stripePaymentState: { type: String, enum: ['pending', 'processing', 'paid', 'failed', 'expired'] },
  stripeLastEventId: { type: String },
  inventoryState: { type: String, enum: ['none', 'deducted', 'restored', 'unavailable'], default: 'none' },
  inventoryError: { type: String, default: '' },
  stockAllocations: [{
    _id: false,
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: mongoose.Schema.Types.ObjectId,
    variantLabel: String,
    sku: String,
    qty: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  }],
  adminPaymentNotification: { type: adminPaymentNotificationSchema, select: false },
  paymentRef: {
    type: String,
    required: true,
  },
  paymentSubmittedAt: {
    type: Date,
  },
  paymentVerificationDeadline: {
    type: Date,
  },
  paymentVerifiedAt: {
    type: Date,
  },
  paymentRejectedAt: {
    type: Date,
  },
  paymentDecisionBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  paymentRejectionReason: {
    type: String,
    default: '',
  },
  customerPaymentNote: {
    type: String,
    default: '',
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
  },
  // Client-supplied idempotency key — prevents duplicate orders when a network
  // retry or double-click fires a second identical checkout request. Optional;
  // existing orders without this field are excluded from the sparse index.
  clientIdempotencyKey: { type: String },
  // Stripe dispute/refund tracking — set by webhook handlers.
  disputeState: {
    type: String,
    enum: ['none', 'open', 'won', 'lost'],
    default: 'none',
  },
  refundState: {
    type: String,
    enum: ['none', 'refunded', 'partial'],
    default: 'none',
  },
}, {
  timestamps: true,
});

orderSchema.index({ stripeCheckoutSessionId: 1 }, { unique: true, sparse: true });
orderSchema.index({ 'adminPaymentNotification.createdAt': -1, _id: -1 }, {
  partialFilterExpression: { 'adminPaymentNotification.createdAt': { $exists: true } },
});
// Admin order list: filter by status + sort by date.
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
// Customer lookup and order tracking.
orderSchema.index({ 'guestInfo.email': 1 });
// Prevent duplicate orders from network retries. sparse=true so existing
// orders without this field are not affected by the unique constraint.
orderSchema.index({ clientIdempotencyKey: 1 }, { unique: true, sparse: true });

export const Order = mongoose.model('Order', orderSchema);
