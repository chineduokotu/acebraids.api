import express from 'express';
import {
  getOrderById,
  getOrderByTrackingCode,
  getAdminOrders,
  updateOrderStatus,
} from '../controllers/orderController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.route('/')
  .get(protect, adminOnly, getAdminOrders);

router.route('/track/:code')
  .get(getOrderByTrackingCode);

router.route('/:id')
  .get(getOrderById);

router.route('/:id/status')
  .put(protect, adminOnly, updateOrderStatus);

export default router;
