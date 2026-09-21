import express from 'express';
import { protect, adminOnly } from '../middleware/auth.js';
import {
  getAdminNotifications,
  markAdminNotificationRead,
  streamAdminNotifications,
} from '../controllers/adminNotificationController.js';

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.get('Origin');
  if (origin) {
    try {
      const configuredOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
        .split(',').map((value) => {
          try {
            return new URL(value.trim()).origin;
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
        return res.status(403).json({ message: 'This origin is not allowed to access admin notifications.' });
      }
    } catch {
      return res.status(503).json({ message: 'Notifications are temporarily unavailable.' });
    }
  }
  next();
});
router.use(protect, adminOnly);
router.get('/', getAdminNotifications);
router.get('/stream', streamAdminNotifications);
router.patch('/:id/read', markAdminNotificationRead);

export default router;
