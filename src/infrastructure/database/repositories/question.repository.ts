import { Db } from "mongodb";
import { Question } from "../../../domain/entities/question";
import { MongoDBRepository } from "../mongodb.repository";

export class QuestionRepository extends MongoDBRepository<Question> {
  constructor(db: Db) {
    super(db, "questions");
  }

  protected toDomain(doc: Record<string, any>): Question {
    const { _id, ...rest } = doc;
    // Use id field if present, otherwise fall back to _id for backward compatibility
    const id = rest.id || _id?.toString();
    return {
      ...rest,
      id,
    } as Question;
  }

  async findByUserId(userId: string): Promise<Question[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  async findByAudioFileId(audioFileId: string): Promise<Question[]> {
    const docs = await this.collection
      .find({ audioFileId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  async findByAudioFileIdPaginated(
    audioFileId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ questions: Question[]; total: number; page: number; limit: number; totalPages: number }> {
    const skip = (page - 1) * limit;
    
    const [docs, total] = await Promise.all([
      this.collection
        .find({ audioFileId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      this.collection.countDocuments({ audioFileId }),
    ]);
    
    const questions = docs.map((doc: Record<string, any>) => this.toDomain(doc));
    const totalPages = Math.ceil(total / limit);
    
    return {
      questions,
      total,
      page,
      limit,
      totalPages,
    };
  }
}

