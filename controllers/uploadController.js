import { isCloudinaryConfigured, uploadFileToCloudinary } from '../config/cloudinary.js';

// @desc    Upload media file(s) to Cloudinary (or fallback to local server disk)
// @route   POST /api/upload
// @access  Private/Admin
export const uploadMedia = async (req, res) => {
  try {
    const useCloudinary = isCloudinaryConfigured();

    // 1. Single File Upload
    if (req.file) {
      const isVideo = req.file.mimetype.startsWith('video') || /\.(mp4|mov|webm)$/i.test(req.file.filename);

      if (useCloudinary) {
        const cloudResult = await uploadFileToCloudinary(req.file.path);
        return res.status(201).json({
          success: true,
          url: cloudResult.secure_url,
          publicId: cloudResult.public_id,
          format: cloudResult.format,
          resourceType: cloudResult.resource_type,
          isVideo: cloudResult.resource_type === 'video' || isVideo,
          storage: 'cloudinary',
        });
      }

      // Local storage fallback
      const fileUrl = `/uploads/${req.file.filename}`;
      return res.status(201).json({
        success: true,
        url: fileUrl,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        isVideo,
        storage: 'local',
      });
    }

    // 2. Multiple Files Upload
    if (req.files && req.files.length > 0) {
      if (useCloudinary) {
        const uploadPromises = req.files.map(file => uploadFileToCloudinary(file.path));
        const results = await Promise.all(uploadPromises);

        const uploaded = results.map(cloudResult => ({
          url: cloudResult.secure_url,
          publicId: cloudResult.public_id,
          format: cloudResult.format,
          resourceType: cloudResult.resource_type,
          isVideo: cloudResult.resource_type === 'video',
          storage: 'cloudinary',
        }));

        return res.status(201).json({
          success: true,
          files: uploaded,
        });
      }

      // Local storage fallback
      const uploaded = req.files.map(file => {
        const isVideo = file.mimetype.startsWith('video') || /\.(mp4|mov|webm)$/i.test(file.filename);
        return {
          url: `/uploads/${file.filename}`,
          filename: file.filename,
          mimetype: file.mimetype,
          isVideo,
          storage: 'local',
        };
      });

      return res.status(201).json({
        success: true,
        files: uploaded,
      });
    }

    return res.status(400).json({ message: 'No media file provided' });
  } catch (error) {
    console.error('Media upload controller error:', error);
    res.status(500).json({ message: error.message || 'Failed to upload media asset' });
  }
};
