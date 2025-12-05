import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";

export interface CleanupFailedUploadsUseCaseParams {
  timeoutMinutes?: number; // Maximum age in minutes before considering a job stuck (default: 30)
  limit?: number; // Maximum number of jobs to process per run (default: 100)
}

export interface CleanupFailedUploadsResult {
  processed: number; // Number of jobs marked as failed
  skipped: number; // Number of jobs that were already failed/completed
  errors: number; // Number of errors encountered
  results: Array<{
    jobId: string;
    status: "failed" | "skipped" | "error";
    error?: string;
  }>;
}

export class CleanupFailedUploadsUseCase {
  constructor(private uploadJobRepository: UploadJobRepository) {}

  async execute(params: CleanupFailedUploadsUseCaseParams): Promise<CleanupFailedUploadsResult> {
    const { timeoutMinutes = 30, limit = 100 } = params;

    // Find stuck upload jobs
    const stuckJobs = await this.uploadJobRepository.findStuckUploadJobs(timeoutMinutes, limit);

    console.log(`[CleanupFailedUploads] Found ${stuckJobs.length} stuck upload jobs to process`);

    const result: CleanupFailedUploadsResult = {
      processed: 0,
      skipped: 0,
      errors: 0,
      results: [],
    };

    for (const job of stuckJobs) {
      try {
        // Skip if already failed or completed
        if (job.status === "failed" || job.status === "completed") {
          result.skipped++;
          result.results.push({
            jobId: job.id,
            status: "skipped",
          });
          continue;
        }

        // Calculate how long the job has been stuck
        const stuckSince = job.startedAt || job.createdAt;
        const stuckDurationMs = Date.now() - stuckSince.getTime();
        const stuckDurationMinutes = Math.floor(stuckDurationMs / (60 * 1000));

        // Mark as failed with appropriate error message
        const errorMessage = `Upload job timed out after ${stuckDurationMinutes} minutes. Status was "${job.status}" but no progress was made. This may have occurred due to a server restart or network issue.`;

        await this.uploadJobRepository.update(job.id, {
          status: "failed",
          error: errorMessage,
          completedAt: new Date(),
        });

        result.processed++;
        result.results.push({
          jobId: job.id,
          status: "failed",
        });

        console.log(
          `[CleanupFailedUploads] Marked upload job ${job.id} as failed (stuck for ${stuckDurationMinutes} minutes, status: ${job.status})`
        );
      } catch (error: any) {
        result.errors++;
        result.results.push({
          jobId: job.id,
          status: "error",
          error: error.message || "Unknown error",
        });
        console.error(`[CleanupFailedUploads] Error processing job ${job.id}:`, error);
      }
    }

    return result;
  }
}

