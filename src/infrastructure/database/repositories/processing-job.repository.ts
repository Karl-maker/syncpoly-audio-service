import { Db } from "mongodb";
import { ProcessingJob } from "../../../domain/entities/processing-job";
import { MongoDBRepository } from "../mongodb.repository";

export class ProcessingJobRepository extends MongoDBRepository<ProcessingJob> {
  constructor(db: Db) {
    super(db, "processingJobs");
    // Create additional indexes for efficient queries
    this.ensureAdditionalIndexes();
  }

  private async ensureAdditionalIndexes(): Promise<void> {
    try {
      // Index on userId for fast filtering (base class already creates id index)
      await this.collection.createIndex({ userId: 1 });
      // Index on audioFileId for fast filtering
      await this.collection.createIndex({ audioFileId: 1 });
      // Compound unique index on idempotencyKey and userId to prevent duplicates
      await this.collection.createIndex(
        { idempotencyKey: 1, userId: 1 },
        { unique: true, sparse: true } // sparse: only index documents that have idempotencyKey
      );
    } catch (error) {
      // Indexes might already exist, ignore error
      console.log("[ProcessingJobRepository] Index creation skipped (may already exist)");
    }
  }

  async findByUserId(userId: string): Promise<ProcessingJob[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  async findByAudioFileId(audioFileId: string): Promise<ProcessingJob[]> {
    const docs = await this.collection
      .find({ audioFileId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  /**
   * Find a processing job by idempotency key
   */
  async findByIdempotencyKey(idempotencyKey: string, userId: string): Promise<ProcessingJob | null> {
    const doc = await this.collection.findOne({ 
      idempotencyKey,
      userId // Ensure it belongs to the same user
    });
    return doc ? this.toDomain(doc as Record<string, any>) : null;
  }

  /**
   * Find the last 10 processing jobs for a user in any status
   * Sorted by createdAt descending (most recent first)
   */
  async findRecentJobsByUserId(userId: string, limit: number = 10): Promise<ProcessingJob[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  /**
   * Acquire a lock on a processing job to prevent duplicate processing.
   * Returns true if lock was acquired, false if already locked (and not stale).
   * @param jobId The job ID to lock
   * @param lockedBy Identifier for what's acquiring the lock (e.g., process ID)
   * @param lockTimeoutMs Lock timeout in milliseconds (default: 5 minutes)
   * @returns true if lock was acquired, false if already locked
   */
  async acquireLock(jobId: string, lockedBy: string, lockTimeoutMs: number = 5 * 60 * 1000): Promise<boolean> {
    const job = await this.findById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Check if job is already locked
    if (job.lockedAt && job.lockedBy) {
      // Check if lock is stale (expired)
      const lockAge = Date.now() - job.lockedAt.getTime();
      const timeout = job.lockTimeout || lockTimeoutMs;
      
      if (lockAge < timeout) {
        // Lock is still valid, cannot acquire
        console.log(`[ProcessingJobRepository] Job ${jobId} is locked by ${job.lockedBy} (age: ${lockAge}ms, timeout: ${timeout}ms)`);
        return false;
      } else {
        // Lock is stale, release it first
        console.log(`[ProcessingJobRepository] Job ${jobId} has stale lock (age: ${lockAge}ms > timeout: ${timeout}ms), releasing...`);
        await this.releaseLock(jobId);
      }
    }

    // Acquire the lock
    const now = new Date();
    await this.update(jobId, {
      lockedAt: now,
      lockedBy,
      lockTimeout: lockTimeoutMs,
    } as Partial<ProcessingJob>);

    console.log(`[ProcessingJobRepository] Lock acquired on job ${jobId} by ${lockedBy}`);
    return true;
  }

  /**
   * Release a lock on a processing job.
   * @param jobId The job ID to unlock
   */
  async releaseLock(jobId: string): Promise<void> {
    // Use $unset to properly remove lock fields from MongoDB
    await this.collection.findOneAndUpdate(
      { id: jobId },
      {
        $unset: {
          lockedAt: "",
          lockedBy: "",
          lockTimeout: "",
        },
        $set: {
          updatedAt: new Date(),
        },
      }
    );
    console.log(`[ProcessingJobRepository] Lock released on job ${jobId}`);
  }

  /**
   * Check if a job is currently locked.
   * @param jobId The job ID to check
   * @returns true if locked and not stale, false otherwise
   */
  async isLocked(jobId: string): Promise<boolean> {
    const job = await this.findById(jobId);
    if (!job || !job.lockedAt || !job.lockedBy) {
      return false;
    }

    // Check if lock is stale
    const lockAge = Date.now() - job.lockedAt.getTime();
    const timeout = job.lockTimeout || 5 * 60 * 1000;
    
    if (lockAge >= timeout) {
      // Lock is stale, consider it unlocked
      return false;
    }

    return true;
  }

  /**
   * Find incomplete jobs that are not locked (or have stale locks).
   * These are jobs that are pending, processing, or failed and can be retried.
   * @param limit Maximum number of jobs to return (after filtering)
   * @param lockTimeoutMs Lock timeout in milliseconds (default: 5 minutes)
   * @returns Array of incomplete, unlockable jobs
   */
  async findIncompleteUnlockedJobs(limit: number = 50, lockTimeoutMs: number = 5 * 60 * 1000): Promise<ProcessingJob[]> {
    const staleLockThreshold = new Date(Date.now() - lockTimeoutMs);

    // Find jobs that are incomplete (pending, processing, or failed)
    // and either not locked, or have stale locks
    // Use a higher limit initially to account for filtering
    const fetchLimit = limit * 3; // Fetch 3x more to account for filtering
    const docs = await this.collection
      .find({
        status: { $in: ["pending", "processing", "failed"] },
        $or: [
          // Not locked at all
          { lockedAt: { $exists: false } },
          { lockedAt: null },
          // Lock is stale (older than timeout)
          { lockedAt: { $lt: staleLockThreshold } }
        ]
      })
      .sort({ updatedAt: 1 }) // Process oldest first
      .limit(fetchLimit)
      .toArray();

    // Filter out jobs that are actually locked (with non-stale locks)
    // and check retry limits
    const jobs = docs.map((doc: Record<string, any>) => this.toDomain(doc));
    const unlockedJobs: ProcessingJob[] = [];

    for (const job of jobs) {
      // Stop if we've reached the desired limit
      if (unlockedJobs.length >= limit) {
        break;
      }

      // Double-check lock status (handles per-job timeout)
      const isLocked = await this.isLocked(job.id);
      if (!isLocked) {
        // Check retry limit
        const retryCount = job.retryCount || 0;
        const maxRetries = job.maxRetries || 5;
        
        if (retryCount < maxRetries) {
          unlockedJobs.push(job);
        } else {
          console.log(`[ProcessingJobRepository] Job ${job.id} has exceeded max retries (${retryCount}/${maxRetries}), skipping`);
        }
      }
    }

    return unlockedJobs;
  }
}

