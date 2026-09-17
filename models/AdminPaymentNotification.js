import mongoose from 'mongoose';

// Embedded in the same Order update as the confirmed payment. Keeping this
// durable snapshot alongside that transition removes any payment/delivery gap.
export const adminPaymentNotificationSchema = new mongoose.Schema({
  createdAt: { type: Date, required: true },
  eventId: { type: String, required: true },
  orderReference: { type: String, required: true },
  customer: {
    name: { type: String, required: true },
    email: { type: String, required: true },
  },
  items: [{
    _id: false,
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    variant: { color: String, length: String, capSize: String },
    price: { type: Number, required: true, min: 0 },
  }],
  amount: { type: Number, required: true, min: 0 },
  amountMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, required: true, uppercase: true },
  paymentStatus: { type: String, enum: ['paid'], required: true },
  paymentMethod: { type: String, enum: ['stripe'], required: true },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { _id: false });
