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
   * Find all processing jobs for a user that are currently processing (status: "processing" or "pending")
   * and were created or started in the past day
   */
  async findProcessingJobsInPastDay(userId: string): Promise<ProcessingJob[]> {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const docs = await this.collection
      .find({
        userId,
        status: { $in: ["pending", "processing"] },
        $or: [
          { createdAt: { $gte: oneDayAgo } },
          { startedAt: { $gte: oneDayAgo } },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();
    
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }
}

