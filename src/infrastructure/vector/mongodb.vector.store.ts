import { Db, Collection } from "mongodb";
import {
  IVectorStore,
  VectorRecord,
  VectorSearchResult,
} from "../../domain/interfaces/ivector.store";

/**
 * MongoDB-based vector store implementation.
 * Stores embeddings in MongoDB with proper indexing for efficient similarity search.
 */
export class MongoDBVectorStore implements IVectorStore {
  private collection: Collection;

  constructor(db: Db, collectionName: string = "vectorEmbeddings") {
    this.collection = db.collection(collectionName);
    // Create indexes for efficient queries
    this.ensureIndexes();
  }

  private async ensureIndexes(): Promise<void> {
    try {
      // Index on userId for fast filtering
      await this.collection.createIndex({ userId: 1 });
      // Index on audioFileId for fast filtering
      await this.collection.createIndex({ audioFileId: 1 });
      // Compound index for common queries
      await this.collection.createIndex({ userId: 1, audioFileId: 1 });
      // Index on audioSourceId for filtering
      await this.collection.createIndex({ "metadata.audioSourceId": 1 });
    } catch (error) {
      // Indexes might already exist, ignore error
      console.log("[MongoDBVectorStore] Index creation skipped (may already exist)");
    }
  }

  async upsertMany(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    console.log(`[MongoDBVectorStore] Upserting ${records.length} records`);

    // Extract userId and audioFileId from metadata
    const operations = records.map((record) => {
      const userId = record.metadata.userId;
      const audioFileId = record.metadata.audioFileId;
      const audioSourceId = record.metadata.audioSourceId;

      if (!userId) {
        throw new Error("userId is required in metadata for MongoDB vector store");
      }
      if (!audioFileId) {
        throw new Error("audioFileId is required in metadata for MongoDB vector store");
      }

      // Create document with proper structure
      const doc = {
        id: record.id,
        userId,
        audioFileId,
        embedding: record.embedding,
        metadata: record.metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return {
        updateOne: {
          filter: { id: record.id },
          update: { $set: doc },
          upsert: true,
        },
      };
    });

    await this.collection.bulkWrite(operations);
    console.log(`[MongoDBVectorStore] Successfully upserted ${records.length} records`);
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, any>
  ): Promise<VectorSearchResult[]> {
    console.log(`[MongoDBVectorStore] Searching with filter:`, filter);

    // Build MongoDB query filter
    const mongoFilter: Record<string, any> = {};
    
    if (filter?.userId) {
      mongoFilter.userId = filter.userId;
    }
    
    // Handle single audioFileId (backwards compatible)
    if (filter?.audioFileId) {
      mongoFilter.audioFileId = filter.audioFileId;
    }
    
    // Handle multiple audioFileIds
    if (filter?.audioFileIds && Array.isArray(filter.audioFileIds) && filter.audioFileIds.length > 0) {
      mongoFilter.audioFileId = { $in: filter.audioFileIds };
    }
    
    // Only filter by audioSourceId if audioFileId is NOT provided
    // This allows searching by audioFileId alone, which works for both:
    // - Old vectors stored with part keys (audioSourceId = bucket/key-part-0)
    // - New vectors stored with original file keys (audioSourceId = bucket/key)
    // When audioFileId is provided, it's sufficient to find all vectors for that file
    const hasAudioFileIdFilter = filter?.audioFileId || (filter?.audioFileIds && Array.isArray(filter.audioFileIds) && filter.audioFileIds.length > 0);
    
    if (!hasAudioFileIdFilter) {
      // Only filter by audioSourceId when audioFileId is not provided
      // Handle single audioSourceId (backwards compatible)
      if (filter?.audioSourceId) {
        mongoFilter["metadata.audioSourceId"] = filter.audioSourceId;
      }
      
      // Handle multiple audioSourceIds
      if (filter?.audioSourceIds && Array.isArray(filter.audioSourceIds) && filter.audioSourceIds.length > 0) {
        mongoFilter["metadata.audioSourceId"] = { $in: filter.audioSourceIds };
      }
    }

    // Fetch all matching records (for small datasets, this is fine)
    // For larger datasets, you'd want to use approximate nearest neighbor search
    const records = await this.collection.find(mongoFilter).toArray();

    console.log(`[MongoDBVectorStore] Found ${records.length} records matching filter`);

    if (records.length === 0) {
      return [];
    }

    // Calculate cosine similarity for each record
    const scored = records
      .map((doc: any) => {
        const record: VectorRecord = {
          id: doc.id,
          embedding: doc.embedding,
          metadata: doc.metadata,
        };
        return {
          record,
          score: this.cosineSimilarity(queryEmbedding, record.embedding),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    console.log(`[MongoDBVectorStore] Returning ${scored.length} results (requested topK: ${topK})`);
    if (scored.length > 0) {
      console.log(`[MongoDBVectorStore] Top similarity scores:`, scored.slice(0, 3).map(s => s.score.toFixed(4)));
    }

    return scored.map((s) => ({
      id: s.record.id,
      score: s.score,
      metadata: s.record.metadata,
    }));
  }

  /**
   * Calculate cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));

    if (!normA || !normB) return 0;
    return dot / (normA * normB);
  }

  /**
   * Delete all vectors for a specific audio file.
   */
  async deleteByAudioFileId(audioFileId: string): Promise<number> {
    const result = await this.collection.deleteMany({ audioFileId });
    console.log(`[MongoDBVectorStore] Deleted ${result.deletedCount} vectors for audioFileId: ${audioFileId}`);
    return result.deletedCount;
  }

  /**
   * Delete all vectors for a specific user.
   */
  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.collection.deleteMany({ userId });
    console.log(`[MongoDBVectorStore] Deleted ${result.deletedCount} vectors for userId: ${userId}`);
    return result.deletedCount;
  }
}

