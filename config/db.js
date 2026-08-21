import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoMemoryServer = null;

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/acebeautybraids';
  
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.warn(`⚠️ Local MongoDB connection failed (${error.message}). Falling back to MongoMemoryServer...`);
    try {
      mongoMemoryServer = await MongoMemoryServer.create({
        instance: {
          dbName: 'acebeautybraids'
        }
      });
      const memoryUri = mongoMemoryServer.getUri();
      const conn = await mongoose.connect(memoryUri);
      console.log(`✅ In-Memory MongoDB Connected at: ${memoryUri}`);
      return conn;
    } catch (memError) {
      console.error(`❌ Failed to start In-Memory MongoDB:`, memError);
      throw memError;
    }
  }
};

export const disconnectDB = async () => {
  await mongoose.disconnect();
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
  }
};
