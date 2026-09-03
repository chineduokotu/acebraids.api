import mongoose from 'mongoose';

const customerLookSchema = new mongoose.Schema({
  title: {
    type: String,
    default: 'Glamour Look',
  },
  customerName: {
    type: String,
    default: 'Ace Babe',
  },
  videoUrl: {
    type: String,
    required: true,
  },
  posterUrl: {
    type: String,
    default: '',
  },
  linkedProduct: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  order: {
    type: Number,
    default: 0,
  }
}, {
  timestamps: true,
});

export const CustomerLook = mongoose.model('CustomerLook', customerLookSchema);
