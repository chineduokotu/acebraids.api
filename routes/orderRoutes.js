import express from 'express';
import {
  getOrderById,
  getOrderByTrackingCode,
  getOrderPaymentStatus,
  getAdminOrders,
  getPendingTransfers,
  updateOrderStatus,
  approvePayment,
  rejectPayment,
} from '../controllers/orderController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.route('/')
  .get(protect, adminOnly, getAdminOrders);

router.route('/admin/pending-transfers')
  .get(protect, adminOnly, getPendingTransfers);

router.route('/track/:code')
  .get(getOrderByTrackingCode);

router.route('/:id/payment-status')
  .get(getOrderPaymentStatus);

router.route('/:id/payment/approve')
  .put(protect, adminOnly, approvePayment);

router.route('/:id/payment/reject')
  .put(protect, adminOnly, rejectPayment);

router.route('/:id')
  .get(getOrderById);

router.route('/:id/status')
  .put(protect, adminOnly, updateOrderStatus);

export default router;
