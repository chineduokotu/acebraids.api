import express from 'express';
import {
  getBankDetails,
  createBankTransferOrder,
  confirmBankTransfer,
} from '../controllers/paymentController.js';

const router = express.Router();

router.get('/bank-transfer/details', getBankDetails);
router.post('/bank-transfer/order', createBankTransferOrder);
router.post('/bank-transfer/:orderId/confirm', confirmBankTransfer);

// Mock Checkout Endpoint
export default router;
