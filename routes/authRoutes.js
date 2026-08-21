import express from 'express';
import {
  register,
  login,
  adminLogin,
  getMe,
  logout,
  toggleWishlist,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/admin/login', adminLogin);
router.post('/logout', logout);
router.get('/me', protect, getMe);
router.post('/wishlist/:productId', protect, toggleWishlist);

export default router;
