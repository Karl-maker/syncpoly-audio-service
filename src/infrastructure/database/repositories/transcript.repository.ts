import { Db } from "mongodb";
import { Transcript } from "../../../domain/entities/transcript";
import { MongoDBRepository } from "../mongodb.repository";

export class TranscriptRepository extends MongoDBRepository<Transcript> {
  constructor(db: Db) {
    super(db, "transcripts");
  }

  protected toDomain(doc: Record<string, any>): Transcript {
    const { _id, updatedAt, ...rest } = doc; // Remove updatedAt as Transcript doesn't have it
    return {
      ...rest,
      id: _id.toString(),
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
    const doc: Record<string, any> = {
      ...this.toMongo(entity),
      createdAt: now,
      updatedAt: now, // Store in DB but not in domain entity
    };
    const result = await this.collection.insertOne(doc);
    return this.toDomain({ ...doc, _id: result.insertedId } as Record<string, any>);
  }

  async findByAudioSourceId(audioSourceId: string): Promise<Transcript[]> {
    const docs = await this.collection
      .find({ audioSourceId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }

  async findByUserId(userId: string): Promise<Transcript[]> {
    // Note: This requires joining with audio files or storing userId in transcript
    // For now, we'll search by audioSourceId pattern if it contains userId
    const docs = await this.collection
      .find({ audioSourceId: { $regex: userId } })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc: Record<string, any>) => this.toDomain(doc));
  }
}

