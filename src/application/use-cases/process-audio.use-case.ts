import { AudioProcessingPipeline } from "../pipeline/audio.processing.pipeline";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { ProcessingJob } from "../../domain/entities/processing-job";
import { S3AudioSource } from "../../infrastructure/aws/s3.audio.source";
import { IAudioSource } from "../../domain/interfaces/iaudio.source";

export interface ProcessAudioUseCaseParams {
  audioFileId: string;
  userId: string;
  vectorStoreType?: "openai" | "in-memory";
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
    private processingPipeline: AudioProcessingPipeline
  ) {}

  async execute(params: ProcessAudioUseCaseParams): Promise<ProcessingJob> {
    const {
      audioFileId,
      userId,
      vectorStoreType = "in-memory",
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
    const job = await this.processingJobRepository.create({
      audioFileId,
      userId,
      status: "pending",
      vectorStoreType,
      options: {
        ...options,
        skipTranscription,
        skipEmbeddings,
        skipVectorStore,
      },
    } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);

    // Start processing asynchronously
    this.processAudioAsync(job, audioFile, s3Config).catch((error) => {
      console.error(`Processing job ${job.id} failed:`, error);
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
      if (audioFile.s3Uri) {
        audioSource = new S3AudioSource(audioFile.s3Uri, s3Config);
      } else {
        throw new Error("Audio file must have S3 URI for processing");
      }

      // Create processing context
      const context: AudioProcessingContext = {
        audioSource,
        audioSourceProvider: audioFile.audioSourceProvider,
        options: job.options,
      };

      // Run pipeline
      const result = await this.processingPipeline.run(context);

      // Update job with results
      await this.processingJobRepository.update(job.id, {
        status: "completed",
        transcriptId: result.transcript?.id,
        completedAt: new Date(),
      });
    } catch (error: any) {
      await this.processingJobRepository.update(job.id, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
      });
    }
  }
}

