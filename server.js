import 'dotenv/config';

import app from './app.js';
import { connectDB } from './config/db.js';
import { seedInitialDataIfNeeded } from './config/seed.js';
import { getJwtSecret } from './config/auth.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    getJwtSecret();
    await connectDB();
    
    // Auto-seed initial catalog if database is fresh
    await seedInitialDataIfNeeded();

    app.listen(PORT, () => {
      console.log(`\n======================================================`);
      console.log(`✨ AceBeautyBraids API Server running on port ${PORT}`);
      console.log(`🌐 Local API: http://localhost:${PORT}/api/health`);
      console.log(`🛍️ Client Origin: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
      console.log(`======================================================\n`);
    });
  } catch (error) {
    console.error(`❌ Server initialization error:`, error);
    process.exit(1);
  }
};

startServer();
