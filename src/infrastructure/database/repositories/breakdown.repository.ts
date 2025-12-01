import { Db } from "mongodb";
import { Breakdown } from "../../../domain/entities/breakdown";
import { MongoDBRepository } from "../mongodb.repository";

export class BreakdownRepository extends MongoDBRepository<Breakdown> {
  constructor(db: Db) {
    super(db, "breakdowns");
  }

  protected toDomain(doc: Record<string, any>): Breakdown {
    const { _id, ...rest } = doc;
    return {
      ...rest,
      id: _id.toString(),
      // Backward compatibility: default orderIndex to 0 if not present
      orderIndex: rest.orderIndex !== undefined ? rest.orderIndex : 0,
    } as Breakdown;
  }

  async findByUserId(userId: string): Promise<Breakdown[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  /**
   * Find all breakdowns for an audio file, sorted by orderIndex
   */
  async findByAudioFileId(audioFileId: string): Promise<Breakdown[]> {
    const docs = await this.collection
      .find({ audioFileId })
      .sort({ orderIndex: 1, createdAt: 1 }) // Sort by orderIndex first, then createdAt
      .toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  /**
   * Find a single breakdown by audioFileId and orderIndex
   */
  async findByAudioFileIdAndOrder(audioFileId: string, orderIndex: number): Promise<Breakdown | null> {
    const doc = await this.collection.findOne({ audioFileId, orderIndex });
    return doc ? this.toDomain(doc) : null;
  }
}

