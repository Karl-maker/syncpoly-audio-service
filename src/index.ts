import express from "express";
import cors from "cors";
import { config } from "./infrastructure/config/app.config";
import { connectToMongoDB, getDb } from "./infrastructure/database/mongodb.connection";
import { AudioFileRepository } from "./infrastructure/database/repositories/audio-file.repository";
import { ProcessingJobRepository } from "./infrastructure/database/repositories/processing-job.repository";
import { UploadJobRepository } from "./infrastructure/database/repositories/upload-job.repository";
import { TranscriptRepository } from "./infrastructure/database/repositories/transcript.repository";
import { ChatMessageRepository } from "./infrastructure/database/repositories/chat-message.repository";
import { TaskRepository } from "./infrastructure/database/repositories/task.repository";
import { QuestionRepository } from "./infrastructure/database/repositories/question.repository";
import { BreakdownRepository } from "./infrastructure/database/repositories/breakdown.repository";
import { CustomerRepository } from "./infrastructure/database/repositories/customer.repository";
import { S3AudioStorage } from "./infrastructure/aws/s3.audio.storage";
import { UploadAudioUseCase } from "./application/use-cases/upload-audio.use-case";
import { UploadVideoUseCase } from "./application/use-cases/upload-video.use-case";
import { UploadVideoFromUrlUseCase } from "./application/use-cases/upload-video-from-url.use-case";
import { ProcessAudioUseCase } from "./application/use-cases/process-audio.use-case";
import { GetMemoryUsageUseCase } from "./application/use-cases/get-memory-usage.use-case";
import { GetUploadProgressUseCase } from "./application/use-cases/get-upload-progress.use-case";
import { GetIncompleteUploadJobsUseCase } from "./application/use-cases/get-incomplete-upload-jobs.use-case";
import { GetProcessingProgressUseCase } from "./application/use-cases/get-processing-progress.use-case";
import { GetProcessingJobsUseCase } from "./application/use-cases/get-processing-jobs.use-case";
import { GetTranscriptUseCase } from "./application/use-cases/get-transcript.use-case";
import { UpdateTranscriptUseCase } from "./application/use-cases/update-transcript.use-case";
import { CalculateUsagePeriodUseCase } from "./application/use-cases/calculate-usage-period.use-case";
import { GenerateBreakdownUseCase } from "./application/use-cases/generate-breakdown.use-case";
import { CreateBreakdownUseCase } from "./application/use-cases/create-breakdown.use-case";
import { UpdateBreakdownUseCase } from "./application/use-cases/update-breakdown.use-case";
import { GetBreakdownUseCase } from "./application/use-cases/get-breakdown.use-case";
import { DeleteBreakdownUseCase } from "./application/use-cases/delete-breakdown.use-case";
import { CreateCustomerUseCase } from "./application/use-cases/create-customer.use-case";
import { GetCustomerUseCase } from "./application/use-cases/get-customer.use-case";
import { UpdateCustomerUseCase } from "./application/use-cases/update-customer.use-case";
import { DeactivateCustomerUseCase } from "./application/use-cases/deactivate-customer.use-case";
import { ResumeIncompleteJobsUseCase } from "./application/use-cases/resume-incomplete-jobs.use-case";
import { GetQuestionsByAudioFileUseCase } from "./application/use-cases/get-questions-by-audio-file.use-case";
import { GetTasksByAudioFileUseCase } from "./application/use-cases/get-tasks-by-audio-file.use-case";
import { UpdateTaskStatusUseCase } from "./application/use-cases/update-task-status.use-case";
import { DeleteTaskUseCase } from "./application/use-cases/delete-task.use-case";
import { JobRecoveryCron } from "./infrastructure/cron/job-recovery.cron";
import { UploadCleanupCron } from "./infrastructure/cron/upload-cleanup.cron";
import { AudioController } from "./presentation/controllers/audio.controller";
import { ChatController } from "./presentation/controllers/chat.controller";
import { CustomerController } from "./presentation/controllers/customer.controller";
import { createAudioRoutes } from "./presentation/routes/audio.routes";
import { createCustomerRoutes } from "./presentation/routes/customer.routes";
import { ChatUseCase } from "./application/use-cases/chat.use-case";
import { AudioProcessingPipeline } from "./application/pipeline/audio.processing.pipeline";
import { TranscriptionStep } from "./application/steps/transcription.step";
import { ChunkAndEmbedStep } from "./application/steps/chunk.and.embed.step";
import { StoreInVectorDbStep } from "./application/steps/store.in.vector.db.step";
import { OpenAITranscriptionProvider } from "./infrastructure/openai/openai.transcription.provider";
import { OpenAIEmbeddingProvider } from "./infrastructure/openai/openai.embedding.provider";
import { InMemoryVectorStore } from "./infrastructure/vector/in.memory.vector.store";
import { MongoDBVectorStore } from "./infrastructure/vector/mongodb.vector.store";

async function main() {
  try {
    // Connect to MongoDB
    await connectToMongoDB();
    const db = getDb();

    // Initialize repositories
    const audioFileRepository = new AudioFileRepository(db);
    const processingJobRepository = new ProcessingJobRepository(db);
    const uploadJobRepository = new UploadJobRepository(db);
    const transcriptRepository = new TranscriptRepository(db);
    const taskRepository = new TaskRepository(db);
    const questionRepository = new QuestionRepository(db);
    const chatMessageRepository = new ChatMessageRepository(db, taskRepository, questionRepository);
    const breakdownRepository = new BreakdownRepository(db);
    const customerRepository = new CustomerRepository(db);

    // Initialize infrastructure
    const transcriptionProvider = new OpenAITranscriptionProvider(config.openaiApiKey);
    const embeddingProvider = new OpenAIEmbeddingProvider(config.openaiApiKey);

    // Initialize vector stores
    const inMemoryVectorStore = new InMemoryVectorStore();
    // Use MongoDB for vector storage (supports userId/audioFileId organization)
    const mongodbVectorStore = new MongoDBVectorStore(db, "vectorEmbeddings");
    
    // For processing and chat, use MongoDB vector store
    const chatVectorStore = mongodbVectorStore;

    // Initialize S3 storage if configured
    // Ensure region is explicitly set from config
    const s3Region = config.aws.region;
    if (!s3Region || typeof s3Region !== "string") {
      console.warn("Warning: AWS_REGION not set, defaulting to us-east-1");
    }
    
    const s3Storage =
      config.aws.accessKeyId && config.aws.secretAccessKey
        ? new S3AudioStorage({
            region: s3Region || "us-east-1",
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
      uploadJobRepository,
      processingJobRepository,
      s3Storage
    );
    const uploadVideoUseCase = new UploadVideoUseCase(
      audioFileRepository,
      uploadJobRepository,
      processingJobRepository,
      s3Storage
    );
    const uploadVideoFromUrlUseCase = new UploadVideoFromUrlUseCase(
      audioFileRepository,
      uploadJobRepository,
      processingJobRepository,
      s3Storage
    );
    const processAudioUseCase = new ProcessAudioUseCase(
        audioFileRepository,
        processingJobRepository,
        transcriptRepository,
        transcriptionProvider,
        embeddingProvider,
        inMemoryVectorStore,
        mongodbVectorStore
      );
    const getMemoryUsageUseCase = new GetMemoryUsageUseCase(
      audioFileRepository,
      processingJobRepository,
      transcriptRepository,
      chatMessageRepository
    );
    const calculateUsagePeriodUseCase = new CalculateUsagePeriodUseCase(
      audioFileRepository,
      processingJobRepository,
      transcriptRepository,
      chatMessageRepository
    );
    const getUploadProgressUseCase = new GetUploadProgressUseCase(uploadJobRepository);
    const getIncompleteUploadJobsUseCase = new GetIncompleteUploadJobsUseCase(uploadJobRepository);
    const getProcessingProgressUseCase = new GetProcessingProgressUseCase(processingJobRepository);
    const getProcessingJobsUseCase = new GetProcessingJobsUseCase(processingJobRepository);
    const getTranscriptUseCase = new GetTranscriptUseCase(
      transcriptRepository,
      audioFileRepository
    );
    const updateTranscriptUseCase = new UpdateTranscriptUseCase(
      transcriptRepository,
      audioFileRepository
    );
    const generateBreakdownUseCase = new GenerateBreakdownUseCase(
      audioFileRepository,
      breakdownRepository,
      transcriptRepository,
      taskRepository,
      questionRepository,
      config.openaiApiKey
    );
    const createBreakdownUseCase = new CreateBreakdownUseCase(
      audioFileRepository,
      breakdownRepository,
      taskRepository,
      questionRepository
    );
    const updateBreakdownUseCase = new UpdateBreakdownUseCase(
      breakdownRepository,
      taskRepository,
      questionRepository
    );
    const getBreakdownUseCase = new GetBreakdownUseCase(breakdownRepository);
    const deleteBreakdownUseCase = new DeleteBreakdownUseCase(breakdownRepository);
    const createCustomerUseCase = new CreateCustomerUseCase(customerRepository);
    const getCustomerUseCase = new GetCustomerUseCase(customerRepository);
    const updateCustomerUseCase = new UpdateCustomerUseCase(customerRepository);
    const deactivateCustomerUseCase = new DeactivateCustomerUseCase(customerRepository);
    // Set processing job repository on upload job repository for cross-collection queries
    uploadJobRepository.setProcessingJobRepository(processingJobRepository);

    const resumeIncompleteJobsUseCase = new ResumeIncompleteJobsUseCase(
      processingJobRepository,
      audioFileRepository,
      uploadJobRepository,
      processAudioUseCase
    );

    const getQuestionsByAudioFileUseCase = new GetQuestionsByAudioFileUseCase(
      questionRepository,
      audioFileRepository
    );
    const getTasksByAudioFileUseCase = new GetTasksByAudioFileUseCase(
      taskRepository,
      audioFileRepository
    );
    const updateTaskStatusUseCase = new UpdateTaskStatusUseCase(taskRepository);
    const deleteTaskUseCase = new DeleteTaskUseCase(taskRepository);

    // Initialize chat use case
    const chatUseCase = new ChatUseCase(
      embeddingProvider,
      chatVectorStore,
      audioFileRepository,
      chatMessageRepository,
      taskRepository,
      questionRepository,
      customerRepository,
      config.openaiApiKey
    );

    // Initialize controllers
    const audioController = new AudioController(
      uploadAudioUseCase,
      uploadVideoUseCase,
      uploadVideoFromUrlUseCase,
      processAudioUseCase,
      getMemoryUsageUseCase,
      calculateUsagePeriodUseCase,
      getUploadProgressUseCase,
      getIncompleteUploadJobsUseCase,
      getProcessingProgressUseCase,
      getProcessingJobsUseCase,
      getTranscriptUseCase,
      updateTranscriptUseCase,
      generateBreakdownUseCase,
      createBreakdownUseCase,
      updateBreakdownUseCase,
      getBreakdownUseCase,
      deleteBreakdownUseCase,
      getQuestionsByAudioFileUseCase,
      getTasksByAudioFileUseCase,
      updateTaskStatusUseCase,
      deleteTaskUseCase,
      audioFileRepository,
      breakdownRepository
    );
    const chatController = new ChatController(chatUseCase, chatMessageRepository);
    const customerController = new CustomerController(
      createCustomerUseCase,
      getCustomerUseCase,
      updateCustomerUseCase,
      deactivateCustomerUseCase
    );

    // Initialize Express app
    const app = express();

    // Middleware
    // Enable CORS for all origins
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Health check
    app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Routes
    app.use("/api/audio", createAudioRoutes(audioController, chatController));
    app.use("/api/customer", createCustomerRoutes(customerController));

    // Error handling middleware
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error("Error:", err);
      res.status(err.status || 500).json({
        error: err.message || "Internal server error",
      });
    });

    // Initialize and start cron job for job recovery
    const jobRecoveryCron = new JobRecoveryCron(resumeIncompleteJobsUseCase);
    jobRecoveryCron.start();

    // Initialize and start cron job for upload cleanup
    const uploadCleanupCron = new UploadCleanupCron(uploadJobRepository);
    uploadCleanupCron.start();

    // Start server
    app.listen(config.port, () => {
      console.log(`Audio service running on port ${config.port}`);
      console.log(`Health check: http://localhost:${config.port}/health`);
      console.log(`API endpoints: http://localhost:${config.port}/api/audio`);
    });

    // Store cron references for graceful shutdown
    (global as any).jobRecoveryCron = jobRecoveryCron;
    (global as any).uploadCleanupCron = uploadCleanupCron;
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  if ((global as any).jobRecoveryCron) {
    (global as any).jobRecoveryCron.stop();
  }
  if ((global as any).uploadCleanupCron) {
    (global as any).uploadCleanupCron.stop();
  }
  const { closeMongoDBConnection } = await import("./infrastructure/database/mongodb.connection");
  await closeMongoDBConnection();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully");
  if ((global as any).jobRecoveryCron) {
    (global as any).jobRecoveryCron.stop();
  }
  if ((global as any).uploadCleanupCron) {
    (global as any).uploadCleanupCron.stop();
  }
  const { closeMongoDBConnection } = await import("./infrastructure/database/mongodb.connection");
  await closeMongoDBConnection();
  process.exit(0);
});

main();

