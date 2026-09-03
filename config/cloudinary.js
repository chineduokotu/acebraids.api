import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Configure Cloudinary credentials from environment
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Checks if Cloudinary credentials are fully provided in environment
 */
export const isCloudinaryConfigured = () => {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
};

/**
 * Upload a local file to Cloudinary with automatic resource type detection
 * @param {string} filePath - Absolute or relative path to the local file
 * @param {object} customOptions - Additional Cloudinary options
 * @returns {Promise<object>} Cloudinary upload result
 */
export const uploadFileToCloudinary = async (filePath, customOptions = {}) => {
  try {
    const options = {
      folder: 'acebeautybraids',
      resource_type: 'auto', // Automatically handles both images (jpg, png, webp) and videos (mp4, mov)
      ...customOptions,
    };

    const result = await cloudinary.uploader.upload(filePath, options);
    
    // Clean up temporary local file once uploaded to cloud
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.warn('Notice: Local temp file cleanup error:', cleanupErr.message);
      }
    }

    return result;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
};

/**
 * Delete a media asset from Cloudinary
 * @param {string} publicId - Cloudinary asset public ID
 * @param {string} resourceType - 'image' | 'video' | 'raw'
 */
export const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error('Cloudinary deletion error:', error);
    throw error;
  }
};

export default cloudinary;
