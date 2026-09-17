import express from 'express';
import {
  getBankDetails,
  createBankTransferOrder,
  createStripeCheckoutSession,
  handleStripeWebhook,
  confirmBankTransfer,
} from '../controllers/paymentController.js';

const router = express.Router();

router.get('/bank-transfer/details', getBankDetails);
router.post('/bank-transfer/order', createBankTransferOrder);
router.post('/bank-transfer/:orderId/confirm', confirmBankTransfer);
router.post('/stripe/checkout-session', createStripeCheckoutSession);
router.post('/stripe/webhook', handleStripeWebhook);

export default router;
