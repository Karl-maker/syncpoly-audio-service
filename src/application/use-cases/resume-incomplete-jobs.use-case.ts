import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { ProcessAudioUseCase } from "./process-audio.use-case";
import { ProcessingJob } from "../../domain/entities/processing-job";

export interface ResumeIncompleteJobsUseCaseParams {
  limit?: number; // Maximum number of jobs to process in one run
  maxRetries?: number; // Maximum retries per job (default: 5)
  checkUnprocessedUploads?: boolean; // Whether to check for completed uploads without processing jobs (default: true)
}

export class ResumeIncompleteJobsUseCase {
  constructor(
    private processingJobRepository: ProcessingJobRepository,
    private audioFileRepository: AudioFileRepository,
    private uploadJobRepository: UploadJobRepository,
    private processAudioUseCase: ProcessAudioUseCase
  ) {}

  async execute(params: ResumeIncompleteJobsUseCaseParams = {}): Promise<{
    processed: number;
    skipped: number;
    errors: number;
    unprocessedUploadsStarted: number;
    results: Array<{ jobId: string; status: "resumed" | "skipped" | "error" | "started"; error?: string; audioFileId?: string }>;
  }> {
    const { limit = 50, maxRetries = 5, checkUnprocessedUploads = true } = params;

    console.log(`[ResumeIncompleteJobs] Starting to find incomplete, unlocked jobs (limit: ${limit})`);

    // Find incomplete jobs that are not locked
    const incompleteJobs = await this.processingJobRepository.findIncompleteUnlockedJobs(limit);

    console.log(`[ResumeIncompleteJobs] Found ${incompleteJobs.length} incomplete, unlocked jobs`);

    const results: Array<{ jobId: string; status: "resumed" | "skipped" | "error" | "started"; error?: string; audioFileId?: string }> = [];
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    let unprocessedUploadsStarted = 0;

    for (const job of incompleteJobs) {
      try {
        // Verify audio file still exists
        const audioFile = await this.audioFileRepository.findById(job.audioFileId);
        if (!audioFile) {
          console.log(`[ResumeIncompleteJobs] Audio file ${job.audioFileId} not found for job ${job.id}, skipping`);
          results.push({
            jobId: job.id,
            status: "skipped",
            error: "Audio file not found",
          });
          skipped++;
          continue;
        }

        // Update retry count
        const retryCount = (job.retryCount || 0) + 1;
        const jobMaxRetries = job.maxRetries || maxRetries;

        if (retryCount > jobMaxRetries) {
          console.log(`[ResumeIncompleteJobs] Job ${job.id} has exceeded max retries (${retryCount}/${jobMaxRetries}), skipping`);
          results.push({
            jobId: job.id,
            status: "skipped",
            error: `Exceeded max retries (${retryCount}/${jobMaxRetries})`,
          });
          skipped++;
          continue;
        }

        // Update job with retry information
        await this.processingJobRepository.update(job.id, {
          retryCount,
          maxRetries: jobMaxRetries,
          lastRetryAt: new Date(),
        } as Partial<ProcessingJob>);

        console.log(`[ResumeIncompleteJobs] Resuming job ${job.id} (retry ${retryCount}/${jobMaxRetries})`);

        // Resume processing by calling process-audio use case
        // This will handle lock acquisition and processing
        await this.processAudioUseCase.execute({
          audioFileId: job.audioFileId,
          userId: job.userId,
          idempotencyKey: job.idempotencyKey,
          vectorStoreType: (job.vectorStoreType as "mongodb" | "openai" | "in-memory") || "mongodb",
          skipTranscription: job.options?.skipTranscription,
          skipEmbeddings: job.options?.skipEmbeddings,
          skipVectorStore: job.options?.skipVectorStore,
          options: job.options,
        });

        results.push({
          jobId: job.id,
          status: "resumed",
        });
        processed++;
      } catch (error: any) {
        console.error(`[ResumeIncompleteJobs] Error resuming job ${job.id}:`, error);
        results.push({
          jobId: job.id,
          status: "error",
          error: error.message || "Unknown error",
        });
        errors++;
      }
    }

    // Check for completed uploads without processing jobs
    if (checkUnprocessedUploads) {
      console.log(`[ResumeIncompleteJobs] Checking for completed uploads without processing jobs...`);
      
      try {
        const unprocessedUploads = await this.uploadJobRepository.findCompletedUploadsWithoutProcessingJobs(limit);
        console.log(`[ResumeIncompleteJobs] Found ${unprocessedUploads.length} completed uploads without processing jobs`);

        for (const uploadJob of unprocessedUploads) {
          if (!uploadJob.audioFileId) {
            continue;
          }

          try {
            // Verify audio file exists
            const audioFile = await this.audioFileRepository.findById(uploadJob.audioFileId);
            if (!audioFile) {
              console.log(`[ResumeIncompleteJobs] Audio file ${uploadJob.audioFileId} not found for upload job ${uploadJob.id}, skipping`);
              results.push({
                jobId: uploadJob.id,
                status: "skipped",
                error: "Audio file not found",
                audioFileId: uploadJob.audioFileId,
              });
              skipped++;
              continue;
            }

            // Verify audio file has S3 bucket info (required for processing)
            if (!audioFile.s3Bucket) {
              console.log(`[ResumeIncompleteJobs] Audio file ${uploadJob.audioFileId} does not have S3 bucket set for upload job ${uploadJob.id}, skipping (upload may still be in progress)`);
              results.push({
                jobId: uploadJob.id,
                status: "skipped",
                error: "Audio file missing S3 bucket (upload may still be in progress)",
                audioFileId: uploadJob.audioFileId,
              });
              skipped++;
              continue;
            }

            console.log(`[ResumeIncompleteJobs] Starting processing for upload job ${uploadJob.id}, audio file ${uploadJob.audioFileId}`);

            // Start processing by calling process-audio use case
            // This will create a new processing job
            await this.processAudioUseCase.execute({
              audioFileId: uploadJob.audioFileId,
              userId: uploadJob.userId,
              vectorStoreType: "mongodb", // Default to MongoDB
            });

            results.push({
              jobId: uploadJob.id,
              status: "started",
              audioFileId: uploadJob.audioFileId,
            });
            unprocessedUploadsStarted++;
          } catch (error: any) {
            console.error(`[ResumeIncompleteJobs] Error starting processing for upload job ${uploadJob.id}:`, error);
            results.push({
              jobId: uploadJob.id,
              status: "error",
              error: error.message || "Unknown error",
              audioFileId: uploadJob.audioFileId,
            });
            errors++;
          }
        }
      } catch (error: any) {
        console.error(`[ResumeIncompleteJobs] Error checking for unprocessed uploads:`, error);
      }
    }

    console.log(
      `[ResumeIncompleteJobs] Completed: ${processed} resumed, ${skipped} skipped, ${errors} errors, ${unprocessedUploadsStarted} uploads started`
    );

    return {
      processed,
      skipped,
      errors,
      unprocessedUploadsStarted,
      results,
    };
  }
}

