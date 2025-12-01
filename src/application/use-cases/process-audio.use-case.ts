import { AudioProcessingPipeline } from "../pipeline/audio.processing.pipeline";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { ProcessingJob } from "../../domain/entities/processing-job";
import { S3AudioSource } from "../../infrastructure/aws/s3.audio.source";
import { IAudioSource } from "../../domain/interfaces/iaudio.source";
import { IVectorStore } from "../../domain/interfaces/ivector.store";
import { ITranscriptionProvider } from "../../domain/interfaces/itranscription.provider";
import { IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";
import { TranscriptionStep } from "../steps/transcription.step";
import { ChunkAndEmbedStep } from "../steps/chunk.and.embed.step";
import { StoreInVectorDbStep } from "../steps/store.in.vector.db.step";
import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";

export interface ProcessAudioUseCaseParams {
  audioFileId: string;
  userId: string;
  vectorStoreType?: "mongodb" | "openai" | "in-memory"; // "mongodb" is the default and recommended option
  skipTranscription?: boolean;
  skipEmbeddings?: boolean;
  skipVectorStore?: boolean;
  options?: Record<string, any>;
  s3Config?: {
    region?: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
    endpoint?: string;
    forcePathStyle?: boolean;
  };
}

export class ProcessAudioUseCase {
  constructor(
    private audioFileRepository: AudioFileRepository,
    private processingJobRepository: ProcessingJobRepository,
    private transcriptRepository: TranscriptRepository,
    private transcriptionProvider: ITranscriptionProvider,
    private embeddingProvider: IEmbeddingProvider,
    private inMemoryVectorStore: IVectorStore,
    private openaiVectorStore: IVectorStore
  ) {}

  async execute(params: ProcessAudioUseCaseParams): Promise<ProcessingJob> {
    const {
      audioFileId,
      userId,
      vectorStoreType = "mongodb", // Default to MongoDB vector store
      skipTranscription = false,
      skipEmbeddings = false,
      skipVectorStore = false,
      options = {},
      s3Config,
    } = params;

    // Get audio file
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file not found: ${audioFileId}`);
    }

    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Create processing job
    const jobOptions = {
      ...options,
      skipTranscription: skipTranscription === true,
      skipEmbeddings: skipEmbeddings === true,
      skipVectorStore: skipVectorStore === true,
    };
    
    console.log(`[ProcessAudio] Creating job with options:`, JSON.stringify(jobOptions));
    
    const job = await this.processingJobRepository.create({
      audioFileId,
      userId,
      status: "pending",
      vectorStoreType,
      options: jobOptions,
    } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);
    
    console.log(`[ProcessAudio] Created job ${job.id} with options:`, JSON.stringify(job.options));

    // Start processing asynchronously
    this.processAudioAsync(job, audioFile, s3Config).catch((error) => {
      console.error(`[ProcessAudio] Processing job ${job.id} failed:`, error);
      console.error(`[ProcessAudio] Error stack:`, error.stack);
    });

    return job;
  }

  private async processAudioAsync(
    job: ProcessingJob,
    audioFile: any,
    s3Config?: ProcessAudioUseCaseParams["s3Config"]
  ): Promise<void> {
    try {
      // Update job status
      await this.processingJobRepository.update(job.id, {
        status: "processing",
        startedAt: new Date(),
      });

      // Create audio source
      let audioSource: IAudioSource;
      if (audioFile.s3Bucket && audioFile.s3Key) {
        audioSource = new S3AudioSource(audioFile.s3Bucket, audioFile.s3Key, s3Config);
      } else {
        throw new Error("Audio file must have S3 bucket and key for processing");
      }

      // Use MongoDB vector store (supports userId/audioFileId organization)
      // The vectorStoreType parameter is kept for API compatibility but MongoDB is always used
      const vectorStore = this.openaiVectorStore; // This is actually MongoDBVectorStore now

      console.log(`[ProcessAudio] Using vector store: ${job.vectorStoreType} for audio file: ${audioFile.id}`);

      // Build pipeline dynamically based on options
      console.log(`[ProcessAudio] Job options:`, JSON.stringify(job.options));
      console.log(`[ProcessAudio] skipTranscription: ${job.options?.skipTranscription}, skipEmbeddings: ${job.options?.skipEmbeddings}, skipVectorStore: ${job.options?.skipVectorStore}`);
      
      const steps = [];
      if (!job.options?.skipTranscription) {
        console.log(`[ProcessAudio] Adding TranscriptionStep`);
        steps.push(new TranscriptionStep(this.transcriptionProvider, this.transcriptRepository));
      } else {
        console.log(`[ProcessAudio] Skipping TranscriptionStep`);
      }
      
      if (!job.options?.skipEmbeddings) {
        console.log(`[ProcessAudio] Adding ChunkAndEmbedStep`);
        steps.push(new ChunkAndEmbedStep(this.embeddingProvider));
      } else {
        console.log(`[ProcessAudio] Skipping ChunkAndEmbedStep`);
      }
      
      if (!job.options?.skipVectorStore) {
        console.log(`[ProcessAudio] Adding StoreInVectorDbStep`);
        steps.push(new StoreInVectorDbStep(vectorStore));
      } else {
        console.log(`[ProcessAudio] Skipping StoreInVectorDbStep`);
      }

      console.log(`[ProcessAudio] Pipeline will have ${steps.length} steps`);
      const pipeline = new AudioProcessingPipeline(steps);

      // Create processing context with file metadata
      const context: AudioProcessingContext = {
        audioSource,
        audioSourceProvider: audioFile.audioSourceProvider,
        options: {
          ...job.options,
          filename: audioFile.filename || audioFile.originalFilename || "audio.wav",
          mimeType: audioFile.mimeType || "audio/wav",
          audioFileId: audioFile.id, // Pass audioFileId for vector naming (audioFileId-segmentId)
          userId: job.userId, // Pass userId for vector organization
        },
      };
      
      console.log(`[ProcessAudio] Processing context created with filename: ${context.options?.filename}, mimeType: ${context.options?.mimeType}`);

      console.log(`[ProcessAudio] Starting pipeline execution with ${steps.length} steps`);
      console.log(`[ProcessAudio] Audio source ID: ${audioSource.getId()}`);

      // Run pipeline
      const result = await pipeline.run(context);
      
      console.log(`[ProcessAudio] Pipeline execution completed`);
      console.log(`[ProcessAudio] Result has transcript: ${!!result.transcript}`);
      console.log(`[ProcessAudio] Result has embeddings: ${!!result.embeddings}, count: ${result.embeddings?.length || 0}`);

      console.log(`[ProcessAudio] Pipeline completed. Transcript: ${result.transcript?.id}, Embeddings: ${result.embeddings?.length || 0}`);

      // Update job with results
      await this.processingJobRepository.update(job.id, {
        status: "completed",
        transcriptId: result.transcript?.id,
        completedAt: new Date(),
      });
    } catch (error: any) {
      console.error(`[ProcessAudio] Error processing audio for job ${job.id}:`, error);
      console.error(`[ProcessAudio] Error stack:`, error.stack);
      await this.processingJobRepository.update(job.id, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
      });
      throw error; // Re-throw to ensure error is visible
    }
  }
}

