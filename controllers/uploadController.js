// @desc    Upload media file(s)
// @route   POST /api/upload
// @access  Private/Admin
export const uploadMedia = (req, res) => {
  try {
    if (req.file) {
      const fileUrl = `/uploads/${req.file.filename}`;
      const isVideo = req.file.mimetype.startsWith('video') || /\.(mp4|mov|webm)$/i.test(req.file.filename);
      return res.status(201).json({
        success: true,
        url: fileUrl,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        isVideo,
      });
    }

    if (req.files && req.files.length > 0) {
      const uploaded = req.files.map(file => {
        const isVideo = file.mimetype.startsWith('video') || /\.(mp4|mov|webm)$/i.test(file.filename);
        return {
          url: `/uploads/${file.filename}`,
          filename: file.filename,
          mimetype: file.mimetype,
          isVideo,
        };
      });

      return res.status(201).json({
        success: true,
        files: uploaded,
      });
    }

    return res.status(400).json({ message: 'No media file provided' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
