import { Db } from "mongodb";
import { randomUUID } from "crypto";
import { Transcript } from "../../../domain/entities/transcript";
import { MongoDBRepository } from "../mongodb.repository";

export class TranscriptRepository extends MongoDBRepository<Transcript> {
  constructor(db: Db) {
    super(db, "transcripts");
  }

  protected toDomain(doc: Record<string, any>): Transcript {
    const { _id, updatedAt, ...rest } = doc; // Remove updatedAt as Transcript doesn't have it
    // Use id field if present, otherwise fall back to _id for backward compatibility
    const id = rest.id || _id?.toString();
    return {
      ...rest,
      id,
      // Backward compatibility: default orderIndex to 0 if not present
      orderIndex: rest.orderIndex !== undefined ? rest.orderIndex : 0,
      createdAt: rest.createdAt instanceof Date ? rest.createdAt : new Date(rest.createdAt),
      segments: (rest.segments || []).map((seg: any) => ({
        id: seg.id,
        speakerId: seg.speakerId,
        text: seg.text,
        startTimeSec: seg.startTimeSec,
        endTimeSec: seg.endTimeSec,
      })),
      speakers: (rest.speakers || []).map((speaker: any) => ({
        id: speaker.id,
        displayName: speaker.displayName,
      })),
    } as Transcript;
  }

  // Override create to handle Transcript without updatedAt
  async create(entity: Omit<Transcript, "id" | "createdAt">): Promise<Transcript> {
    const now = new Date();
    // Generate UUID for id field
    const id = randomUUID();
    const doc: Record<string, any> = {
      ...this.toMongo(entity),
      id, // Store UUID in id field
      createdAt: now,
      updatedAt: now, // Store in DB but not in domain entity
    };
    await this.collection.insertOne(doc);
    return this.toDomain(doc);
  }

  async findByAudioSourceId(audioSourceId: string): Promise<Transcript[]> {
    const docs = await this.collection
      .find({ audioSourceId })
      .sort({ orderIndex: 1, createdAt: 1 }) // Sort by orderIndex first, then createdAt
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  /**
   * Find all transcripts for an audio file, sorted by orderIndex
   */
  async findByAudioFileId(audioFileId: string): Promise<Transcript[]> {
    const docs = await this.collection
      .find({ audioFileId })
      .sort({ orderIndex: 1, createdAt: 1 }) // Sort by orderIndex first, then createdAt
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  async findByUserId(userId: string): Promise<Transcript[]> {
    // Note: This requires joining with audio files or storing userId in transcript
    // For now, we'll search by audioSourceId pattern if it contains userId
    const docs = await this.collection
      .find({ audioSourceId: { $regex: userId } })
      .sort({ orderIndex: 1, createdAt: 1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }
}

