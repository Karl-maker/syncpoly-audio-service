import { Db } from "mongodb";
import { UploadJob } from "../../../domain/entities/upload-job";
import { MongoDBRepository } from "../mongodb.repository";
import { ProcessingJobRepository } from "./processing-job.repository";

export class UploadJobRepository extends MongoDBRepository<UploadJob> {
  private processingJobRepository?: ProcessingJobRepository;

  constructor(db: Db) {
    super(db, "uploadJobs");
  }

  /**
   * Set the processing job repository for cross-collection queries
   */
  setProcessingJobRepository(repository: ProcessingJobRepository): void {
    this.processingJobRepository = repository;
  }

  async findByUserId(userId: string): Promise<UploadJob[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  /**
   * Find incomplete upload jobs for a user with pagination.
   * Incomplete jobs are those with status: pending, uploading, converting, or failed.
   * @param userId The user ID
   * @param page Page number (1-based)
   * @param limit Number of jobs per page (default: 5)
   * @returns Object with jobs array, total count, and pagination info
   */
  async findIncompleteJobsByUserId(
    userId: string,
    page: number = 1,
    limit: number = 5
  ): Promise<{ jobs: UploadJob[]; total: number; totalPages: number; currentPage: number }> {
    const skip = (page - 1) * limit;

    // Find incomplete jobs (not completed)
    const query = {
      userId,
      status: { $in: ["pending", "uploading", "converting", "failed"] },
    };

    // Get total count
    const total = await this.collection.countDocuments(query);

    // Get paginated results
    const docs = await this.collection
      .find(query)
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .toArray();

    const jobs = docs.map((doc: Record<string, any>) => this.toDomain(doc));
    const totalPages = Math.ceil(total / limit);

    return {
      jobs,
      total,
      totalPages,
      currentPage: page,
    };
  }

  /**
   * Find completed upload jobs that don't have any processing jobs.
   * @param limit Maximum number of upload jobs to return
   * @returns Array of completed upload jobs without processing jobs
   */
  async findCompletedUploadsWithoutProcessingJobs(limit: number = 50): Promise<UploadJob[]> {
    if (!this.processingJobRepository) {
      throw new Error("ProcessingJobRepository not set. Call setProcessingJobRepository() first.");
    }

    // Find completed upload jobs with audioFileId
    const completedUploads = await this.collection
      .find({
        status: "completed",
        audioFileId: { $exists: true, $ne: null },
      })
      .sort({ completedAt: -1 }) // Most recently completed first
      .limit(limit)
      .toArray();

    const uploadJobs = completedUploads.map((doc: Record<string, any>) => this.toDomain(doc));

    // Filter out uploads that already have processing jobs
    const unprocessedUploads: UploadJob[] = [];

    for (const uploadJob of uploadJobs) {
      if (!uploadJob.audioFileId) {
        continue;
      }

      // Check if there are any processing jobs for this audio file
      const processingJobs = await this.processingJobRepository.findByAudioFileId(uploadJob.audioFileId);
      
      // Only include if there are no processing jobs at all
      if (processingJobs.length === 0) {
        unprocessedUploads.push(uploadJob);
      }
    }

    return unprocessedUploads;
  }

  /**
   * Find upload jobs that started more than the specified hours ago and are still in progress.
   * These are jobs that likely failed but didn't update their status.
   * @param hoursAgo Number of hours ago to check (default: 1 hour)
   * @param limit Maximum number of jobs to return
   * @returns Array of stuck upload jobs
   */
  async findStuckUploadJobs(hoursAgo: number = 1, limit: number = 100): Promise<UploadJob[]> {
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    // Find jobs that:
    // 1. Have a startedAt timestamp older than cutoffTime
    // 2. Are still in progress (pending, uploading, converting)
    // 3. Are not already completed or failed
    const query = {
      startedAt: { $exists: true, $lt: cutoffTime },
      status: { $in: ["pending", "uploading", "converting"] },
      completedAt: { $exists: false }, // Not already completed
    };

    const docs = await this.collection
      .find(query)
      .sort({ startedAt: 1 }) // Oldest first
      .limit(limit)
      .toArray();

    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  /**
   * Mark multiple upload jobs as failed
   * @param jobIds Array of job IDs to mark as failed
   * @param errorMessage Optional error message to set
   * @returns Number of jobs updated
   */
  async markJobsAsFailed(jobIds: string[], errorMessage: string = "Job timed out after 1 hour"): Promise<number> {
    if (jobIds.length === 0) {
      return 0;
    }

    const result = await this.collection.updateMany(
      { id: { $in: jobIds } },
      {
        $set: {
          status: "failed",
          error: errorMessage,
          completedAt: new Date(),
        },
      }
    );

    return result.modifiedCount;
  }
}





