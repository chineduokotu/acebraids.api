import { PasswordChangeAttempt } from '../models/PasswordChangeAttempt.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export const limitPasswordChanges = async (req, res, next) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + WINDOW_MS);
  const expired = { $lte: [{ $ifNull: ['$expiresAt', new Date(0)] }, now] };
  const update = [{ $set: {
    attempts: { $cond: [expired, 1, { $add: ['$attempts', 1] }] },
    expiresAt: { $cond: [expired, expiresAt, '$expiresAt'] },
  } }];

  try {
    let counter;
    try {
      counter = await PasswordChangeAttempt.findOneAndUpdate(
        { _id: req.user._id }, update, { new: true, upsert: true }
      );
    } catch (error) {
      // Two first requests may race to insert the same account's counter.
      if (error.code !== 11000) throw error;
      counter = await PasswordChangeAttempt.findOneAndUpdate(
        { _id: req.user._id }, update, { new: true, upsert: true }
      );
    }
    if (counter.attempts > MAX_ATTEMPTS) {
      const retryAfter = Math.max(1, Math.ceil((counter.expiresAt.getTime() - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Too many password change attempts. Please try again in 15 minutes.', retryAfter });
    }
    next();
  } catch {
    // Do not allow attempts through if the shared limiter cannot be updated.
    res.status(503).json({ message: 'Password changes are temporarily unavailable. Please try again later.' });
  }
};

export const validatePasswordChangeRequest = (req, res, next) => {
  // Browser forms must not be able to submit this cookie-authenticated action.
  if (!req.is('application/json')) {
    return res.status(415).json({ message: 'Send password changes as JSON.' });
  }
  const origin = req.get('Origin');
  if (origin) {
    try {
      const configuredOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
        .split(',')
        .map((configuredOrigin) => {
          try {
            return new URL(configuredOrigin.trim()).origin;
          } catch {
            return null;
          }
        }).filter(Boolean);
      const officialOrigins = [
        'https://acebraids.co.uk',
        'https://www.acebraids.co.uk',
        'https://acebeautybraids.com',
        'https://www.acebeautybraids.com',
        'https://acebraids.vercel.app',
        'https://acebraids.chineokotu.workers.dev',
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:5000',
      ];
      const allowedOrigins = Array.from(new Set([...configuredOrigins, ...officialOrigins]));
      if (!allowedOrigins.includes(origin)) {
        return res.status(403).json({ message: 'This origin is not allowed to change passwords.' });
      }
    } catch {
      return res.status(503).json({ message: 'Password changes are temporarily unavailable.' });
    }
  }
  next();
};
