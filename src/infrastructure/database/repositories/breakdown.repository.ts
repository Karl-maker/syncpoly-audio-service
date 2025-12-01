import { Db } from "mongodb";
import { Breakdown } from "../../../domain/entities/breakdown";
import { MongoDBRepository } from "../mongodb.repository";

export class BreakdownRepository extends MongoDBRepository<Breakdown> {
  constructor(db: Db) {
    super(db, "breakdowns");
  }

  protected toDomain(doc: Record<string, any>): Breakdown {
    const { _id, ...rest } = doc;
    return { ...rest, id: _id.toString() } as Breakdown;
  }

  async findByUserId(userId: string): Promise<Breakdown[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  async findByAudioFileId(audioFileId: string): Promise<Breakdown | null> {
    const doc = await this.collection.findOne({ audioFileId });
    return doc ? this.toDomain(doc) : null;
  }
}

