import express from "express";
import { config } from "./infrastructure/config/app.config";
import { connectToMongoDB, getDb } from "./infrastructure/database/mongodb.connection";
import { AudioFileRepository } from "./infrastructure/database/repositories/audio-file.repository";
import { ProcessingJobRepository } from "./infrastructure/database/repositories/processing-job.repository";
import { S3AudioStorage } from "./infrastructure/aws/s3.audio.storage";
import { UploadAudioUseCase } from "./application/use-cases/upload-audio.use-case";
import { ProcessAudioUseCase } from "./application/use-cases/process-audio.use-case";
import { GetMemoryUsageUseCase } from "./application/use-cases/get-memory-usage.use-case";
import { AudioController } from "./presentation/controllers/audio.controller";
import { ChatController } from "./presentation/controllers/chat.controller";
import { createAudioRoutes } from "./presentation/routes/audio.routes";
import { ChatUseCase } from "./application/use-cases/chat.use-case";
import { AudioProcessingPipeline } from "./application/pipeline/audio.processing.pipeline";
import { TranscriptionStep } from "./application/steps/transcription.step";
import { ChunkAndEmbedStep } from "./application/steps/chunk.and.embed.step";
import { StoreInVectorDbStep } from "./application/steps/store.in.vector.db.step";
import { OpenAITranscriptionProvider } from "./infrastructure/openai/openai.transcription.provider";
import { OpenAIEmbeddingProvider } from "./infrastructure/openai/openai.embedding.provider";
import { InMemoryVectorStore } from "./infrastructure/vector/in.memory.vector.store";
import { OpenAIVectorStore } from "./infrastructure/vector/openai.vector.store";

async function main() {
  try {
    // Connect to MongoDB
    await connectToMongoDB();
    const db = getDb();

    // Initialize repositories
    const audioFileRepository = new AudioFileRepository(db);
    const processingJobRepository = new ProcessingJobRepository(db);

    // Initialize infrastructure
    const transcriptionProvider = new OpenAITranscriptionProvider(config.openaiApiKey);
    const embeddingProvider = new OpenAIEmbeddingProvider(config.openaiApiKey);

    // Initialize vector stores
    const inMemoryVectorStore = new InMemoryVectorStore();
    const openaiVectorStore = new OpenAIVectorStore(config.openaiApiKey);

    // Use OpenAI vector store for chat if available, otherwise in-memory
    const chatVectorStore = openaiVectorStore || inMemoryVectorStore;

    // Initialize processing pipeline
    const processingPipeline = new AudioProcessingPipeline([
      new TranscriptionStep(transcriptionProvider),
      new ChunkAndEmbedStep(embeddingProvider),
      new StoreInVectorDbStep(inMemoryVectorStore), // Default to in-memory
    ]);

    // Initialize S3 storage if configured
    const s3Storage =
      config.aws.accessKeyId && config.aws.secretAccessKey
        ? new S3AudioStorage({
            region: config.aws.region,
            credentials: {
              accessKeyId: config.aws.accessKeyId,
              secretAccessKey: config.aws.secretAccessKey,
            },
            endpoint: config.aws.s3Endpoint,
            forcePathStyle: config.aws.s3ForcePathStyle,
          })
        : undefined;

    // Initialize use cases
    const uploadAudioUseCase = new UploadAudioUseCase(
      audioFileRepository,
      s3Storage
    );
    const processAudioUseCase = new ProcessAudioUseCase(
      audioFileRepository,
      processingJobRepository,
      processingPipeline
    );
    const getMemoryUsageUseCase = new GetMemoryUsageUseCase(
      audioFileRepository,
      processingJobRepository
    );

    // Initialize chat use case
    const chatUseCase = new ChatUseCase(
      embeddingProvider,
      chatVectorStore,
      audioFileRepository,
      config.openaiApiKey
    );

    // Initialize controllers
    const audioController = new AudioController(
      uploadAudioUseCase,
      processAudioUseCase,
      getMemoryUsageUseCase
    );
    const chatController = new ChatController(chatUseCase);

    // Initialize Express app
    const app = express();

    // Middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Routes
    app.use("/api/audio", createAudioRoutes(audioController, chatController));

    // Error handling middleware
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error("Error:", err);
      res.status(err.status || 500).json({
        error: err.message || "Internal server error",
      });
    });

    // Start server
    app.listen(config.port, () => {
      console.log(`Audio service running on port ${config.port}`);
      console.log(`Health check: http://localhost:${config.port}/health`);
      console.log(`API endpoints: http://localhost:${config.port}/api/audio`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  const { closeMongoDBConnection } = await import("./infrastructure/database/mongodb.connection");
  await closeMongoDBConnection();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully");
  const { closeMongoDBConnection } = await import("./infrastructure/database/mongodb.connection");
  await closeMongoDBConnection();
  process.exit(0);
});

main();

