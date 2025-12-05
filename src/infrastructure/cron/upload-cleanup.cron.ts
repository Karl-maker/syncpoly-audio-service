import * as cron from "node-cron";
import { UploadJobRepository } from "../database/repositories/upload-job.repository";

export class UploadCleanupCron {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(private uploadJobRepository: UploadJobRepository) {}

  /**
   * Start the cron job to run every 10 minutes
   */
  start(): void {
    if (this.task) {
      console.log("[UploadCleanupCron] Cron job is already running");
      return;
    }

    // Run every 10 minutes: "*/10 * * * *"
    this.task = cron.schedule("*/10 * * * *", async () => {
      if (this.isRunning) {
        console.log("[UploadCleanupCron] Previous run is still in progress, skipping this execution");
        return;
      }

      this.isRunning = true;
      const startTime = Date.now();

      try {
        console.log("[UploadCleanupCron] Starting upload cleanup cycle...");
        
        // Find upload jobs that started more than 1 hour ago and are still in progress
        const stuckJobs = await this.uploadJobRepository.findStuckUploadJobs(1, 100);
        
        if (stuckJobs.length === 0) {
          console.log("[UploadCleanupCron] No stuck upload jobs found");
        } else {
          console.log(`[UploadCleanupCron] Found ${stuckJobs.length} stuck upload jobs`);
          
          // Mark them as failed
          const jobIds = stuckJobs.map((job) => job.id);
          const updatedCount = await this.uploadJobRepository.markJobsAsFailed(
            jobIds,
            "Upload job timed out after 1 hour"
          );

          const duration = Date.now() - startTime;
          console.log(
            `[UploadCleanupCron] Cleanup cycle completed in ${duration}ms: ` +
            `${updatedCount} jobs marked as failed`
          );

          // Log details of failed jobs
          if (stuckJobs.length > 0) {
            console.log(
              `[UploadCleanupCron] Failed jobs: ${stuckJobs.map((j) => `${j.id} (${j.status}, started: ${j.startedAt})`).join(", ")}`
            );
          }
        }
      } catch (error: any) {
        const duration = Date.now() - startTime;
        console.error(`[UploadCleanupCron] Error in cleanup cycle (${duration}ms):`, error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log("[UploadCleanupCron] Started cron job to clean up stuck upload jobs (runs every 10 minutes)");
  }

  /**
   * Stop the cron job
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log("[UploadCleanupCron] Stopped cron job");
    }
  }

  /**
   * Check if the cron job is currently running
   */
  isActive(): boolean {
    return this.task !== null;
  }
}
