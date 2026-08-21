import express from 'express';
import {
  getCategories,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.route('/')
  .get(getCategories)
  .post(protect, adminOnly, createCategory);

router.route('/:slug')
  .get(getCategoryBySlug);

router.route('/:id')
  .put(protect, adminOnly, updateCategory)
  .delete(protect, adminOnly, deleteCategory);

export default router;
