import express from 'express';
import {
  getCustomerLooks,
  getAdminCustomerLooks,
  createCustomerLook,
  updateCustomerLook,
  deleteCustomerLook,
} from '../controllers/customerLookController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.route('/')
  .get(getCustomerLooks)
  .post(protect, adminOnly, createCustomerLook);

router.route('/admin')
  .get(protect, adminOnly, getAdminCustomerLooks);

router.route('/:id')
  .put(protect, adminOnly, updateCustomerLook)
  .delete(protect, adminOnly, deleteCustomerLook);

export default router;
