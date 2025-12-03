import { Db } from "mongodb";
import { UploadJob } from "../../../domain/entities/upload-job";
import { MongoDBRepository } from "../mongodb.repository";

export class UploadJobRepository extends MongoDBRepository<UploadJob> {
  constructor(db: Db) {
    super(db, "uploadJobs");
  }

  async findByUserId(userId: string): Promise<UploadJob[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }
}



