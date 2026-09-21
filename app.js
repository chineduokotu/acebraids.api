import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';

import productRoutes from './routes/productRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import customerLookRoutes from './routes/customerLookRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import authRoutes from './routes/authRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import adminNotificationRoutes from './routes/adminNotificationRoutes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Secrets verification — crash-fast in production if required vars are absent.
// ---------------------------------------------------------------------------
export const verifySecrets = () => {
  const REQUIRED = ['MONGODB_URI', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLIENT_URL'];
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    const msg = `Missing required environment variables: ${missing.join(', ')}`;
    // Always fatal — whether in production or dev, running without secrets is wrong.
    logger.error(msg);
    throw new Error(msg);
  }
};

// ---------------------------------------------------------------------------
// CORS — allowlist built dynamically from CLIENT_URL (comma-separated).
// ---------------------------------------------------------------------------
const getCorsAllowlist = () => {
  const raw = process.env.CLIENT_URL || '';
  return raw.split(',').map((u) => {
    try {
      return new URL(u.trim()).origin;
    } catch {
      return u.trim();
    }
  }).filter(Boolean);
};

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no origin header)
    if (!origin) return callback(null, true);
    const allowlist = getCorsAllowlist();
    if (allowlist.includes(origin)) {
      return callback(null, true);
    }
    // Disallow cross-origin responses for unauthorized origins
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Stripe-Signature'],
}));

app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
app.use('/api/auth', express.json({ limit: '8kb' }), express.urlencoded({ extended: false, limit: '8kb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Static file serving for uploads and public media
const uploadDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/customer-looks', customerLookRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'AceBeautyBraids API',
  });
});

// Serve frontend in production if built client exists
const clientDistPath = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

export default app;
