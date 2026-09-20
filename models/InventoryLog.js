import mongoose from 'mongoose';

const inventoryLogSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  variantSku: {
    type: String,
    default: '',
    alias: 'sku',
  },
  variantLabel: {
    type: String,
    default: '',
  },
  changeType: {
    type: String,
    enum: [
      'admin_adjustment',
      'customer_purchase',
      'order_cancellation',
      'order_refund',
      'manual_restock',
      'initial_seed',
    ],
    required: true,
  },
  quantityDelta: {
    type: Number,
    required: true,
    validate: Number.isSafeInteger,
  },
  previousStock: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  },
  newStock: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  notes: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

inventoryLogSchema.index({ product: 1, createdAt: -1 });
inventoryLogSchema.index({ order: 1 });

export const InventoryLog = mongoose.model('InventoryLog', inventoryLogSchema);
