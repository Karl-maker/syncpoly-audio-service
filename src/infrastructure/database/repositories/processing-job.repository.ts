import { Db } from "mongodb";
import { ProcessingJob } from "../../../domain/entities/processing-job";
import { MongoDBRepository } from "../mongodb.repository";

export class ProcessingJobRepository extends MongoDBRepository<ProcessingJob> {
  constructor(db: Db) {
    super(db, "processingJobs");
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
}

