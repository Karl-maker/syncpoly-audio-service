import * as cron from "node-cron";
import { ResumeIncompleteJobsUseCase } from "../../application/use-cases/resume-incomplete-jobs.use-case";

export class JobRecoveryCron {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(private resumeIncompleteJobsUseCase: ResumeIncompleteJobsUseCase) {}

  /**
   * Start the cron job to run every 5 minutes
   */
  start(): void {
    if (this.task) {
      console.log("[JobRecoveryCron] Cron job is already running");
      return;
    }

    // Run every 5 minutes: "*/5 * * * *"
    this.task = cron.schedule("*/1 * * * *", async () => {
      if (this.isRunning) {
        console.log("[JobRecoveryCron] Previous run is still in progress, skipping this execution");
        return;
      }

      this.isRunning = true;
      const startTime = Date.now();

      try {
        console.log("[JobRecoveryCron] Starting job recovery cycle...");
        const result = await this.resumeIncompleteJobsUseCase.execute({
          limit: 50, // Process up to 50 jobs per cycle
          maxRetries: 5, // Maximum 5 retries per job
        });

        const duration = Date.now() - startTime;
        console.log(
          `[JobRecoveryCron] Job recovery cycle completed in ${duration}ms: ` +
          `${result.processed} resumed, ${result.skipped} skipped, ${result.errors} errors, ` +
          `${result.unprocessedUploadsStarted} uploads started`
        );

        // Log any errors
        if (result.errors > 0) {
          const errorJobs = result.results.filter((r) => r.status === "error");
          console.error(`[JobRecoveryCron] Jobs with errors:`, errorJobs);
        }
      } catch (error: any) {
        const duration = Date.now() - startTime;
        console.error(`[JobRecoveryCron] Error in job recovery cycle (${duration}ms):`, error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log("[JobRecoveryCron] Started cron job to recover incomplete jobs (runs every 5 minutes)");
  }

  /**
   * Stop the cron job
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log("[JobRecoveryCron] Stopped cron job");
    }
  }

  /**
   * Check if the cron job is currently running
   */
  isActive(): boolean {
    return this.task !== null;
  }
}

