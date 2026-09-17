import express from 'express';
import {
  register,
  login,
  adminLogin,
  getMe,
  logout,
  toggleWishlist,
  changePassword,
} from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { limitPasswordChanges, validatePasswordChangeRequest } from '../middleware/passwordChange.js';

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/register', register);
router.post('/login', login);
router.post('/admin/login', adminLogin);
router.post('/admin/change-password', protect, adminOnly, validatePasswordChangeRequest, limitPasswordChanges, changePassword);
router.post('/logout', logout);
router.get('/me', protect, getMe);
router.post('/wishlist/:productId', protect, toggleWishlist);

export default router;
