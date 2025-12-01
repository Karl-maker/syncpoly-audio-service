/**
 * Application configuration
 * Centralizes all environment variables with type safety and default values
 */

import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

export interface AppConfig {
  // Server
  port: number;

  // OpenAI
  openaiApiKey: string;

        // AWS S3
        aws: {
          accessKeyId?: string;
          secretAccessKey?: string;
          region: string;
          s3Bucket?: string;
          s3Endpoint?: string; // For S3-compatible services
          s3ForcePathStyle?: boolean; // Use path-style addressing
          cdnUrl?: string; // Optional CDN URL for S3 objects (e.g., "https://cdn.example.com")
        };

  // MongoDB
  mongodb: {
    uri: string;
    dbName: string;
  };

  // JWT
  jwt: {
    secret: string;
  };
}

function getConfig(): AppConfig {
  // Validate required environment variables
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  return {
    port: parseInt(process.env.PORT || "3000", 10),

    openaiApiKey,

          aws: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            region: (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1").trim(),
            s3Bucket: process.env.S3_BUCKET,
            s3Endpoint: process.env.S3_ENDPOINT,
            s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
            cdnUrl: process.env.CDN_URL, // Optional CDN URL
          },

    mongodb: {
      uri: process.env.MONGODB_URI || "mongodb://localhost:27017",
      dbName: process.env.MONGODB_DB_NAME || "audio-service",
    },

    jwt: {
      secret: process.env.JWT_SECRET || "your-secret-key-change-in-production",
    },
  };
}

export const config = getConfig();

