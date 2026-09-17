import mongoose from 'mongoose';

// One counter per account, shared across processes. TTL is cleanup only;
// the middleware checks the expiry itself so MongoDB's TTL delay is harmless.
const passwordChangeAttemptSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  attempts: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const PasswordChangeAttempt = mongoose.model('PasswordChangeAttempt', passwordChangeAttemptSchema);
