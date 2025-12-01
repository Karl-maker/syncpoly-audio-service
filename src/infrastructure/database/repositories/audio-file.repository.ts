import { Db } from "mongodb";
import { AudioFile } from "../../../domain/entities/audio-file";
import { MongoDBRepository } from "../mongodb.repository";

export class AudioFileRepository extends MongoDBRepository<AudioFile> {
  constructor(db: Db) {
    super(db, "audioFiles");
  }

  async findByUserId(userId: string): Promise<AudioFile[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ uploadedAt: -1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  async getTotalStorageByUserId(userId: string): Promise<number> {
    const result = await this.collection.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$fileSize" } } },
    ]).toArray();
    return result[0]?.total || 0;
  }
}

