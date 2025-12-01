import { Db } from "mongodb";
import { Question } from "../../../domain/entities/question";
import { MongoDBRepository } from "../mongodb.repository";

export class QuestionRepository extends MongoDBRepository<Question> {
  constructor(db: Db) {
    super(db, "questions");
  }

  protected toDomain(doc: Record<string, any>): Question {
    const { _id, ...rest } = doc;
    return {
      ...rest,
      id: _id.toString(),
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
}

