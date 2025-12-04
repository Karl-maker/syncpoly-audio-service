import { Db } from "mongodb";
import { Customer } from "../../../domain/entities/customer";
import { MongoDBRepository } from "../mongodb.repository";

export class CustomerRepository extends MongoDBRepository<Customer> {
  constructor(db: Db) {
    super(db, "customers");
    this.ensureAdditionalIndexes();
  }

  private async ensureAdditionalIndexes(): Promise<void> {
    try {
      // Index on userId for fast lookups (should be unique per user)
      await this.collection.createIndex({ userId: 1 }, { unique: true });
    } catch (error) {
      // Index might already exist, ignore error
      console.log("[CustomerRepository] Index creation skipped (may already exist)");
    }
  }

  /**
   * Find customer by userId (returns single customer since userId is unique)
   */
  async findOneByUserId(userId: string): Promise<Customer | null> {
    const doc = await this.collection.findOne({ userId });
    return doc ? this.toDomain(doc) : null;
  }
}

