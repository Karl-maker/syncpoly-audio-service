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
import { AudioChunkingService } from "../../infrastructure/audio/audio-chunking.service";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { hostname } from "os";
import { createHash } from "crypto";

export interface ProcessAudioUseCaseParams {
  audioFileId: string;
  userId: string;
  idempotencyKey?: string; // Optional: idempotency key to prevent duplicate processing
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
  private chunkingService: AudioChunkingService;
  private readonly OPENAI_MAX_SIZE = 24 * 1024 * 1024; // 24MB (OpenAI's limit is 25MB)
  private readonly LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes default lock timeout
  private readonly lockIdentifier: string; // Unique identifier for this process instance

  constructor(
    private audioFileRepository: AudioFileRepository,
    private processingJobRepository: ProcessingJobRepository,
    private transcriptRepository: TranscriptRepository,
    private transcriptionProvider: ITranscriptionProvider,
    private embeddingProvider: IEmbeddingProvider,
    private inMemoryVectorStore: IVectorStore,
    private openaiVectorStore: IVectorStore
  ) {
    this.chunkingService = new AudioChunkingService();
    // Generate unique lock identifier: hostname + process ID
    this.lockIdentifier = `${hostname()}-${process.pid}`;
    
    // Set up process termination handlers to release locks on shutdown
    this.setupProcessTerminationHandlers();
  }

  /**
   * Generate a unique idempotency key from audioFileId and userId.
   * This ensures uniqueness per audio file and user combination.
   */
  private generateIdempotencyKey(audioFileId: string, userId: string): string {
    // Create a hash of audioFileId and userId to ensure uniqueness
    const combined = `${audioFileId}-${userId}`;
    const hash = createHash("sha256").update(combined).digest("hex").substring(0, 16);
    return `audio-${audioFileId}-${hash}`;
  }

  /**
   * Set up handlers to release locks when the process terminates
   */
  private setupProcessTerminationHandlers(): void {
    const cleanup = async () => {
      console.log(`[ProcessAudio] Process terminating, releasing all locks held by ${this.lockIdentifier}...`);
      // Note: We can't easily track all locked jobs here, but stale locks will be automatically
      // released when they expire (30 minutes). For immediate cleanup, we'd need a registry
      // of locked jobs, which adds complexity. The timeout mechanism handles crashes gracefully.
    };

    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
    process.on("uncaughtException", (error) => {
      console.error(`[ProcessAudio] Uncaught exception:`, error);
      cleanup();
    });
    process.on("unhandledRejection", (reason, promise) => {
      console.error(`[ProcessAudio] Unhandled rejection at:`, promise, `reason:`, reason);
      cleanup();
    });
  }

  async execute(params: ProcessAudioUseCaseParams): Promise<ProcessingJob> {
    const {
      audioFileId,
      userId,
      idempotencyKey,
      vectorStoreType = "mongodb", // Default to MongoDB vector store
      skipTranscription = false,
      skipEmbeddings = false,
      skipVectorStore = false,
      options = {},
      s3Config,
    } = params;

    // Get audio file first
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file not found: ${audioFileId}`);
    }

    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Generate idempotency key if not provided
    // This ensures uniqueness per audio file and user, preventing duplicate key errors
    const finalIdempotencyKey = idempotencyKey || this.generateIdempotencyKey(audioFileId, userId);

    // Check for existing job by idempotency key first (uses unique index)
    // This ensures that processing the same audio file again will continue from where it left off
    let existingJob = await this.processingJobRepository.findByIdempotencyKey(finalIdempotencyKey, userId);
    
    // Fallback: if not found by idempotency key, check by audioFileId (for backward compatibility)
    if (!existingJob) {
      const existingJobs = await this.processingJobRepository.findByAudioFileId(audioFileId);
      existingJob = existingJobs.find(j => j.userId === userId) || null;
    }
    
    if (existingJob) {
      // If job is completed, return it immediately
      if (existingJob.status === "completed") {
        console.log(`[ProcessAudio] Job ${existingJob.id} already completed for audio file ${audioFileId}, returning existing job`);
        return existingJob;
      }
      
      // If job is processing or failed, try to acquire lock and resume
      // This allows continuing processing after failures or interruptions
      if (existingJob.status === "processing" || existingJob.status === "failed") {
        // Refresh job state from database to get latest processedParts and lastProcessedPartIndex
        const refreshedJob = await this.processingJobRepository.findById(existingJob.id);
        if (!refreshedJob) {
          throw new Error(`Job ${existingJob.id} not found`);
        }
        
        // Try to acquire lock on the job
        const lockAcquired = await this.processingJobRepository.acquireLock(
          refreshedJob.id,
          this.lockIdentifier,
          this.LOCK_TIMEOUT_MS
        );
        
        if (!lockAcquired) {
          // Job is locked by another process, throw error
          throw new Error(
            `Audio file ${audioFileId} is currently being processed by another process. ` +
            `Please wait for the current processing to complete or try again later.`
          );
        }
        
        const lastPartIndex = refreshedJob.lastProcessedPartIndex ?? -1;
        const processedParts = refreshedJob.processedParts || [];
        console.log(`[ProcessAudio] Resuming job ${refreshedJob.id} from last processed part ${lastPartIndex + 1}, already processed: [${processedParts.join(", ")}]`);
        
        // Update job status to processing if it was failed
        if (refreshedJob.status === "failed") {
          await this.processingJobRepository.update(refreshedJob.id, {
            status: "processing",
            error: undefined, // Clear previous error
          });
          console.log(`[ProcessAudio] Updated job ${refreshedJob.id} status from failed to processing`);
        }
        
        // Get audio file again to ensure we have latest data
        const latestAudioFile = await this.audioFileRepository.findById(audioFileId);
        if (!latestAudioFile) {
          // Release lock before throwing
          await this.processingJobRepository.releaseLock(refreshedJob.id);
          throw new Error(`Audio file not found: ${audioFileId}`);
        }
        
        // Resume processing with the refreshed job (contains latest state)
        // Lock will be released in processAudioAsync's finally block
        this.processAudioAsync(refreshedJob, latestAudioFile, s3Config).catch((error) => {
          console.error(`[ProcessAudio] Processing job ${refreshedJob.id} failed:`, error);
          console.error(`[ProcessAudio] Error stack:`, error.stack);
        });
        
        return refreshedJob;
      }
    }

    // Create new processing job
    const jobOptions = {
      ...options,
      skipTranscription: skipTranscription === true,
      skipEmbeddings: skipEmbeddings === true,
      skipVectorStore: skipVectorStore === true,
    };
    
    console.log(`[ProcessAudio] Creating new job with options:`, JSON.stringify(jobOptions));
    console.log(`[ProcessAudio] Using idempotency key: ${finalIdempotencyKey} (generated from audioFileId: ${audioFileId}, userId: ${userId})`);
    
    const job = await this.processingJobRepository.create({
      audioFileId,
      userId,
      idempotencyKey: finalIdempotencyKey,
      status: "pending",
      progress: 0,
      processedParts: [],
      lastProcessedPartIndex: -1,
      vectorStoreType,
      options: jobOptions,
      retryCount: 0,
      maxRetries: 5, // Default max retries
    } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);
    
    console.log(`[ProcessAudio] Created job ${job.id} with options:`, JSON.stringify(job.options));

    // Acquire lock on the new job before starting processing
    const lockAcquired = await this.processingJobRepository.acquireLock(
      job.id,
      this.lockIdentifier,
      this.LOCK_TIMEOUT_MS
    );
    
    if (!lockAcquired) {
      // This shouldn't happen for a new job, but handle it gracefully
      throw new Error(`Failed to acquire lock on newly created job ${job.id}`);
    }

    // Start processing asynchronously
    // Lock will be released in processAudioAsync's finally block
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
    // Ensure lock is released even if process crashes or terminates
    try {
      // Check if this is a resume (has processed parts or lastProcessedPartIndex >= 0)
      const isResume = (job.processedParts && job.processedParts.length > 0) || (job.lastProcessedPartIndex !== undefined && job.lastProcessedPartIndex >= 0);
      
      // Update job status - preserve progress if resuming
      await this.processingJobRepository.update(job.id, {
        status: "processing",
        progress: isResume ? job.progress : 0, // Preserve progress when resuming
        startedAt: job.startedAt || new Date(), // Preserve original start time if resuming
      });
      
      if (isResume) {
        console.log(`[ProcessAudio] Resuming job ${job.id} with existing progress: ${job.progress}%, processed parts: [${job.processedParts?.join(", ") || "none"}]`);
      }

      if (!audioFile.s3Bucket) {
        throw new Error("Audio file must have S3 bucket for processing");
      }

      // Check if audio file has multiple parts
      const hasParts = audioFile.parts && audioFile.parts.length > 0;
      const partCount = hasParts ? audioFile.parts.length : 1;

      console.log(`[ProcessAudio] Audio file has ${partCount} part(s)`);

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

      // Process each part sequentially
      let allTranscripts: any[] = [];
      let totalEmbeddings = 0;
      const progressPerPart = 90 / partCount; // 90% for parts, 10% for completion

      // Get processed parts from job state (for resuming)
      const processedParts = job.processedParts || [];
      const startFromPartIndex = (job.lastProcessedPartIndex ?? -1) + 1;

      console.log(`[ProcessAudio] Starting from part ${startFromPartIndex + 1}/${partCount}, already processed: [${processedParts.join(", ")}]`);

      if (hasParts) {
        // Process parts sequentially, starting from where we left off
        for (let partIndex = startFromPartIndex; partIndex < partCount; partIndex++) {
          // Skip if already processed
          if (processedParts.includes(partIndex)) {
            console.log(`[ProcessAudio] Part ${partIndex + 1} already processed, skipping`);
            continue;
          }

          console.log(`[ProcessAudio] Processing part ${partIndex + 1}/${partCount}`);

          // Get the part from upload chunks (each part is a separate 10MB S3 object)
          const part = audioFile.parts[partIndex];
          const partSize = part.fileSize || 0;
          
          // Safety check: 10MB chunks should always be under 24MB, but verify just in case
          // If somehow a part exceeds OpenAI's limit, re-chunk it
          if (partSize > this.OPENAI_MAX_SIZE) {
            console.log(`[ProcessAudio] Part ${partIndex + 1} size (${partSize} bytes) exceeds OpenAI limit (${this.OPENAI_MAX_SIZE} bytes), re-chunking...`);
            
            // Download the part from S3
            const partBuffer = await this.downloadS3FileToBuffer(
              audioFile.s3Bucket!,
              part.s3Key,
              s3Config
            );

            // Re-chunk the part into smaller pieces (under 24MB each)
            const subChunks = await this.chunkingService.chunkAudioFile(
              partBuffer,
              audioFile.mimeType || "audio/mpeg",
              {
                chunkSizeBytes: this.OPENAI_MAX_SIZE, // Chunk at 24MB to stay under OpenAI limit
              }
            );

            console.log(`[ProcessAudio] Re-chunked part ${partIndex + 1} into ${subChunks.length} sub-chunks`);

            // Process each sub-chunk sequentially (one at a time)
            const subChunkProgressPerChunk = progressPerPart / subChunks.length;
            for (let subChunkIndex = 0; subChunkIndex < subChunks.length; subChunkIndex++) {
              const subChunk = subChunks[subChunkIndex];
              console.log(`[ProcessAudio] Processing sub-chunk ${subChunkIndex + 1}/${subChunks.length} of part ${partIndex + 1}`);

              // Create a temporary audio source from the buffer
              const subChunkStream = Readable.from(subChunk.buffer);
              const subChunkAudioSource: IAudioSource = {
                getId: () => `${audioFile.s3Bucket}/${part.s3Key}-subchunk-${subChunkIndex}`,
                getReadableStream: () => subChunkStream,
              };

              // Create processing context for this sub-chunk
              const subContext: AudioProcessingContext = {
                audioSource: subChunkAudioSource,
                audioSourceProvider: audioFile.audioSourceProvider,
                options: {
                  ...job.options,
                  filename: audioFile.filename || audioFile.originalFilename || "audio.wav",
                  mimeType: audioFile.mimeType || "audio/wav",
                  audioFileId: audioFile.id,
                  userId: job.userId,
                  partIndex,
                  subChunkIndex,
                  totalParts: partCount,
                  totalSubChunks: subChunks.length,
                },
              };

              // Update progress
              const subChunkStartProgress = 5 + (partIndex * progressPerPart) + (subChunkIndex * subChunkProgressPerChunk);
              await this.processingJobRepository.update(job.id, {
                progress: Math.floor(subChunkStartProgress),
              });

              // Run pipeline for this sub-chunk (one at a time)
              const subResult = await pipeline.run(subContext);

              // Store embeddings immediately
              if (subResult.embeddings && subResult.embeddings.length > 0) {
                totalEmbeddings += subResult.embeddings.length;
                console.log(`[ProcessAudio] Sub-chunk ${subChunkIndex + 1} of part ${partIndex + 1} produced ${subResult.embeddings.length} embeddings`);
              }

              if (subResult.transcript) {
                allTranscripts.push(subResult.transcript);
                console.log(`[ProcessAudio] Sub-chunk ${subChunkIndex + 1} of part ${partIndex + 1} transcript: ${subResult.transcript.id}`);
              }

              // Update progress
              const subChunkEndProgress = 5 + (partIndex * progressPerPart) + ((subChunkIndex + 1) * subChunkProgressPerChunk);
              await this.processingJobRepository.update(job.id, {
                progress: Math.floor(subChunkEndProgress),
              });
            }
          } else {
            // Part is small enough, process directly (one at a time)
            const partAudioSource = new S3AudioSource(audioFile.s3Bucket!, part.s3Key, s3Config);

            // Create processing context for this part
            const context: AudioProcessingContext = {
              audioSource: partAudioSource,
              audioSourceProvider: audioFile.audioSourceProvider,
              options: {
                ...job.options,
                filename: audioFile.filename || audioFile.originalFilename || "audio.wav",
                mimeType: audioFile.mimeType || "audio/wav",
                audioFileId: audioFile.id,
                userId: job.userId,
                partIndex, // Track which part we're processing
                totalParts: partCount,
              },
            };

            // Update progress: start of part
            const partStartProgress = 5 + (partIndex * progressPerPart);
            await this.processingJobRepository.update(job.id, { 
              progress: Math.floor(partStartProgress),
              lastProcessedPartIndex: partIndex - 1, // Update before processing
            });

            // Run pipeline for this part (one at a time)
            const result = await pipeline.run(context);

            // Store embeddings immediately after processing this part
            if (result.embeddings && result.embeddings.length > 0) {
              totalEmbeddings += result.embeddings.length;
              console.log(`[ProcessAudio] Part ${partIndex + 1} produced ${result.embeddings.length} embeddings`);
            }

            if (result.transcript) {
              allTranscripts.push(result.transcript);
              console.log(`[ProcessAudio] Part ${partIndex + 1} transcript: ${result.transcript.id}`);
            }
          }

          // Mark part as processed
          const updatedProcessedParts = [...processedParts, partIndex];
          
          // Update progress: end of part
          const partEndProgress = 5 + ((partIndex + 1) * progressPerPart);
          await this.processingJobRepository.update(job.id, { 
            progress: Math.floor(partEndProgress),
            lastProcessedPartIndex: partIndex,
            processedParts: updatedProcessedParts,
          });

          console.log(`[ProcessAudio] Completed part ${partIndex + 1}/${partCount}`);
        }
      } else {
        // Single file processing (backward compatible)
        let audioSource: IAudioSource;
        if (audioFile.s3Key) {
          // Check if single file exceeds OpenAI limit
          const fileSize = audioFile.fileSize || 0;
          if (fileSize > this.OPENAI_MAX_SIZE) {
            console.log(`[ProcessAudio] Single file size (${fileSize} bytes) exceeds OpenAI limit (${this.OPENAI_MAX_SIZE} bytes), chunking...`);
            
            // Download and chunk the file
            const fileBuffer = await this.downloadS3FileToBuffer(
              audioFile.s3Bucket!,
              audioFile.s3Key,
              s3Config
            );

            const chunks = await this.chunkingService.chunkAudioFile(
              fileBuffer,
              audioFile.mimeType || "audio/mpeg",
              {
                chunkSizeBytes: this.OPENAI_MAX_SIZE,
              }
            );

            console.log(`[ProcessAudio] Chunked single file into ${chunks.length} parts`);

            // Process each chunk sequentially (one at a time)
            const chunkProgressPerChunk = 90 / chunks.length;
            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
              const chunk = chunks[chunkIndex];
              console.log(`[ProcessAudio] Processing chunk ${chunkIndex + 1}/${chunks.length}`);

              const chunkStream = Readable.from(chunk.buffer);
              const chunkAudioSource: IAudioSource = {
                getId: () => `${audioFile.s3Bucket}/${audioFile.s3Key}-chunk-${chunkIndex}`,
                getReadableStream: () => chunkStream,
              };

              const chunkContext: AudioProcessingContext = {
                audioSource: chunkAudioSource,
                audioSourceProvider: audioFile.audioSourceProvider,
                options: {
                  ...job.options,
                  filename: audioFile.filename || audioFile.originalFilename || "audio.wav",
                  mimeType: audioFile.mimeType || "audio/wav",
                  audioFileId: audioFile.id,
                  userId: job.userId,
                },
              };

              await this.processingJobRepository.update(job.id, {
                progress: Math.floor(5 + (chunkIndex * chunkProgressPerChunk)),
              });

              const chunkResult = await pipeline.run(chunkContext);

              if (chunkResult.transcript) {
                allTranscripts.push(chunkResult.transcript);
              }
              if (chunkResult.embeddings) {
                totalEmbeddings += chunkResult.embeddings.length;
              }

              await this.processingJobRepository.update(job.id, {
                progress: Math.floor(5 + ((chunkIndex + 1) * chunkProgressPerChunk)),
              });
            }
          } else {
            // File is small enough, process directly
            audioSource = new S3AudioSource(audioFile.s3Bucket, audioFile.s3Key, s3Config);

            // Create processing context with file metadata
            const context: AudioProcessingContext = {
              audioSource,
              audioSourceProvider: audioFile.audioSourceProvider,
              options: {
                ...job.options,
                filename: audioFile.filename || audioFile.originalFilename || "audio.wav",
                mimeType: audioFile.mimeType || "audio/wav",
                audioFileId: audioFile.id,
                userId: job.userId,
              },
            };
            
            console.log(`[ProcessAudio] Processing context created with filename: ${context.options?.filename}, mimeType: ${context.options?.mimeType}`);
            console.log(`[ProcessAudio] Starting pipeline execution with ${steps.length} steps`);
            console.log(`[ProcessAudio] Audio source ID: ${audioSource.getId()}`);

            // Update progress: 5% - starting
            await this.processingJobRepository.update(job.id, { progress: 5 });

            // Run pipeline
            const result = await pipeline.run(context);
            
            if (result.transcript) {
              allTranscripts.push(result.transcript);
            }
            if (result.embeddings) {
              totalEmbeddings = result.embeddings.length;
            }

            console.log(`[ProcessAudio] Pipeline execution completed`);
            console.log(`[ProcessAudio] Result has transcript: ${!!result.transcript}`);
            console.log(`[ProcessAudio] Result has embeddings: ${!!result.embeddings}, count: ${result.embeddings?.length || 0}`);
          }
        } else {
          throw new Error("Audio file must have S3 key for processing");
        }
      }

      console.log(`[ProcessAudio] Processing completed. Total transcripts: ${allTranscripts.length}, Total embeddings: ${totalEmbeddings}`);

      // Use the first transcript ID for backward compatibility
      const firstTranscriptId = allTranscripts.length > 0 ? allTranscripts[0].id : undefined;

      // Update job with results and complete progress
      await this.processingJobRepository.update(job.id, {
        status: "completed",
        progress: 100,
        transcriptId: firstTranscriptId,
        completedAt: new Date(),
      });
    } catch (error: any) {
      console.error(`[ProcessAudio] Error processing audio for job ${job.id}:`, error);
      console.error(`[ProcessAudio] Error stack:`, error.stack);
      
      // Preserve state on error - don't reset progress, keep processed parts
      // This allows resuming from last successful part
      await this.processingJobRepository.update(job.id, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
        // Keep progress and processedParts so we can resume
      });
      // Don't re-throw here - we want to release the lock in finally block
    } finally {
      // Always release the lock, even on error or premature termination
      try {
        await this.processingJobRepository.releaseLock(job.id);
        console.log(`[ProcessAudio] Lock released for job ${job.id}`);
      } catch (lockError: any) {
        console.error(`[ProcessAudio] Error releasing lock for job ${job.id}:`, lockError);
        // Don't throw - lock will expire automatically after timeout
      }
    }
  }

  /**
   * Download a file from S3 to a buffer.
   */
  private async downloadS3FileToBuffer(
    bucket: string,
    key: string,
    s3Config?: ProcessAudioUseCaseParams["s3Config"]
  ): Promise<Buffer> {
    const region = s3Config?.region || "us-east-1";
    const s3Client = new S3Client({
      region: typeof region === "string" ? region : "us-east-1",
      credentials: s3Config?.credentials,
      endpoint: s3Config?.endpoint,
      forcePathStyle: s3Config?.forcePathStyle || false,
    });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error(`No body returned from S3 for ${bucket}/${key}`);
    }

    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }
}

