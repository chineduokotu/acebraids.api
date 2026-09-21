import 'dotenv/config';

import app, { verifySecrets } from './app.js';
import { connectDB } from './config/db.js';
import { seedInitialDataIfNeeded } from './config/seed.js';
import { getJwtSecret } from './config/auth.js';
import { logger } from './utils/logger.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    verifySecrets();
    getJwtSecret();
    await connectDB();

    // Auto-seed initial catalog if database is fresh
    await seedInitialDataIfNeeded();

    app.listen(PORT, () => {
      logger.info(`AceBeautyBraids API running on port ${PORT}`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        clientOrigins: process.env.CLIENT_URL,
        localApi: `http://localhost:${PORT}/api/health`,
      });
    });
  } catch (error) {
    logger.error('Server initialization failed', { message: error.message, stack: error.stack });
    process.exit(1);
  }
};

startServer();
