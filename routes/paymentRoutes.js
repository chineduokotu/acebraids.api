import express from 'express';
import { mockCheckout } from '../controllers/paymentController.js';

const router = express.Router();

// Mock Checkout Endpoint
router.post('/mock-checkout', mockCheckout);

export default router;
