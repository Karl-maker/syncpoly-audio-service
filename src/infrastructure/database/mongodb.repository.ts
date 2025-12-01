import { Db, Collection } from "mongodb";
import { randomUUID } from "crypto";

export abstract class MongoDBRepository<T extends { id: string }> {
  protected db: Db;
  protected collection: Collection;

  constructor(db: Db, collectionName: string) {
    this.db = db;
    this.collection = db.collection(collectionName);
    // Create indexes for efficient queries (fire and forget)
    this.ensureIndexes().catch((error) => {
      console.error(`[MongoDBRepository] Failed to create indexes for ${collectionName}:`, error);
    });
  }

  protected async ensureIndexes(): Promise<void> {
    try {
      // Create unique index on id field for fast lookups
      await this.collection.createIndex({ id: 1 }, { unique: true });
    } catch (error) {
      // Index might already exist, ignore error
      console.log(`[MongoDBRepository] Index creation skipped for ${this.collection.collectionName} (may already exist)`);
    }
  }

  protected toDomain(doc: Record<string, any>): T {
    const { _id, ...rest } = doc;
    // Use id field if present, otherwise fall back to _id for backward compatibility
    const id = rest.id || _id?.toString();
    return { ...rest, id } as T;
  }

  protected toMongo(entity: Partial<T> | Omit<T, "id" | "createdAt" | "updatedAt">): any {
    // Don't include id in toMongo - it will be generated in create() or used directly in update()
    const { id, ...rest } = entity as any;
    return rest;
  }

  async findById(id: string): Promise<T | null> {
    // Query by id field (UUID), not _id
    const doc = await this.collection.findOne({ id });
    return doc ? this.toDomain(doc) : null;
  }

  async findByUserId(userId: string): Promise<T[]> {
    const docs = await this.collection.find({ userId }).toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  async create(entity: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T> {
    const now = new Date();
    // Generate UUID for id field
    const id = randomUUID();
    const doc: Record<string, any> = {
      ...this.toMongo(entity),
      id, // Store UUID in id field
      createdAt: now,
      updatedAt: now,
    };
    await this.collection.insertOne(doc);
    return this.toDomain(doc);
  }

  async update(id: string, updates: Partial<T>): Promise<T | null> {
    const { id: _, ...updateData } = updates;
    // Query by id field (UUID), not _id
    const result = await this.collection.findOneAndUpdate(
      { id },
      { $set: { ...updateData, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    return result ? this.toDomain(result) : null;
  }

  async delete(id: string): Promise<boolean> {
    // Query by id field (UUID), not _id
    const result = await this.collection.deleteOne({ id });
    return result.deletedCount > 0;
  }
}

