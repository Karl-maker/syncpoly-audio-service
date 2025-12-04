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

  /**
   * Find audio files for a user with pagination.
   * @param userId The user ID
   * @param page Page number (1-based)
   * @param limit Number of files per page (default: 20)
   * @returns Object with files array, total count, and pagination info
   */
  async findByUserIdPaginated(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ files: AudioFile[]; total: number; totalPages: number; currentPage: number }> {
    const skip = (page - 1) * limit;

    // Get total count
    const total = await this.collection.countDocuments({ userId });

    // Get paginated results
    const docs = await this.collection
      .find({ userId })
      .sort({ uploadedAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .toArray();

    const files = docs.map((doc: Record<string, any>) => this.toDomain(doc));
    const totalPages = Math.ceil(total / limit);

    return {
      files,
      total,
      totalPages,
      currentPage: page,
    };
  }

  async getTotalStorageByUserId(userId: string): Promise<number> {
    const result = await this.collection.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$fileSize" } } },
    ]).toArray();
    return result[0]?.total || 0;
  }
}

