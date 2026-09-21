import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Magic-byte signatures for allowed file types.
// Reads the first 12 bytes after the file lands on disk and verifies they
// match the declared MIME type — prevents extension spoofing attacks.
// ---------------------------------------------------------------------------
const MAGIC = {
  'image/jpeg':  { bytes: [0xFF, 0xD8, 0xFF], offset: 0 },
  'image/png':   { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 },
  'image/webp':  { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },   // "WEBP" at offset 8 inside RIFF
  'image/gif':   { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 },   // "GIF8"
  'image/heic':  { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },   // "ftyp" — also used by mp4
  'video/mp4':   { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },   // "ftyp"
  'video/quicktime': { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  'video/webm':  { bytes: [0x1A, 0x45, 0xDF, 0xA3], offset: 0 },
};

const readMagicBytes = (filePath, length) => new Promise((resolve, reject) => {
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, length, 0);
    resolve(buf);
  } catch (err) {
    reject(err);
  } finally {
    fs.closeSync(fd);
  }
});

const verifyMagicBytes = async (file) => {
  const sig = MAGIC[file.mimetype];
  if (!sig) return false;                          // Unknown type — reject
  const buf = await readMagicBytes(file.path, sig.offset + sig.bytes.length);
  return sig.bytes.every((byte, i) => buf[sig.offset + i] === byte);
};

// ---------------------------------------------------------------------------
// Storage — extension is derived from the declared MIME type, not the
// original filename, so a renamed .php → .jpg is saved with .jpg but the
// magic-byte check in the route handler will still reject it.
// ---------------------------------------------------------------------------
const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif',  'image/heic': '.heic', 'video/mp4': '.mp4',
  'video/quicktime': '.mov', 'video/webm': '.webm',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = MIME_TO_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (MIME_TO_EXT[file.mimetype]) return cb(null, true);
  cb(Object.assign(new Error('Only images (jpg, png, webp, gif, heic) and videos (mp4, mov, webm) are allowed'), { status: 415 }));
};

export const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter,
});

/**
 * Express middleware that verifies magic bytes after multer writes the file.
 * Drop this after `upload.single()` / `upload.array()` in any route that
 * accepts file uploads.
 *
 * Usage:
 *   router.post('/upload', upload.single('file'), verifyUploadedFiles, handler)
 */
export const verifyUploadedFiles = async (req, res, next) => {
  const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [];
  if (req.file) files.push(req.file);

  for (const file of files) {
    const valid = await verifyMagicBytes(file).catch(() => false);
    if (!valid) {
      // Delete the already-written file so nothing malicious lingers on disk.
      fs.unlink(file.path, () => {});
      return res.status(415).json({ message: 'Uploaded file content does not match its declared type.' });
    }
  }
  next();
};
