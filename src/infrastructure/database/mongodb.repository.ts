import { Db, Collection, ObjectId } from "mongodb";

export abstract class MongoDBRepository<T extends { id: string }> {
  protected db: Db;
  protected collection: Collection;

  constructor(db: Db, collectionName: string) {
    this.db = db;
    this.collection = db.collection(collectionName);
  }

  protected toDomain(doc: Record<string, any>): T {
    const { _id, ...rest } = doc;
    return { ...rest, id: _id.toString() } as T;
  }

  protected toMongo(entity: Partial<T> | Omit<T, "id" | "createdAt" | "updatedAt">): any {
    const { id, ...rest } = entity as any;
    if (id) {
      return { ...rest, _id: new ObjectId(id) };
    }
    return rest;
  }

  async findById(id: string): Promise<T | null> {
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return doc ? this.toDomain(doc) : null;
  }

  async findByUserId(userId: string): Promise<T[]> {
    const docs = await this.collection.find({ userId }).toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  async create(entity: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T> {
    const now = new Date();
    const doc: Record<string, any> = {
      ...this.toMongo(entity),
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.collection.insertOne(doc);
    return this.toDomain({ ...doc, _id: result.insertedId } as Record<string, any>);
  }

  async update(id: string, updates: Partial<T>): Promise<T | null> {
    const { id: _, ...updateData } = updates;
    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...updateData, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    return result ? this.toDomain(result) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount > 0;
  }
}

