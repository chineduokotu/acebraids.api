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
      const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
        .split(',').map((value) => new URL(value.trim()).origin);
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
