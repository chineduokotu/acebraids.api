import express from 'express';
import { uploadMedia } from '../controllers/uploadController.js';
import { upload } from '../middleware/upload.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// Allow single file under field 'media' or 'file' or 'image', or multiple under 'files'
router.post(
  '/',
  protect,
  adminOnly,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'media', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'files', maxCount: 10 },
  ]),
  (req, res, next) => {
    // Normalise req.file or req.files
    if (req.files?.file?.[0]) req.file = req.files.file[0];
    else if (req.files?.media?.[0]) req.file = req.files.media[0];
    else if (req.files?.image?.[0]) req.file = req.files.image[0];
    else if (req.files?.files) req.files = req.files.files;
    next();
  },
  uploadMedia
);

export default router;
