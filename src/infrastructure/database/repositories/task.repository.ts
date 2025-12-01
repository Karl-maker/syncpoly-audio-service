import { Db } from "mongodb";
import { Task } from "../../../domain/entities/task";
import { MongoDBRepository } from "../mongodb.repository";

export class TaskRepository extends MongoDBRepository<Task> {
  constructor(db: Db) {
    super(db, "tasks");
  }

  protected toDomain(doc: Record<string, any>): Task {
    const { _id, ...rest } = doc;
    // Use id field if present, otherwise fall back to _id for backward compatibility
    const id = rest.id || _id?.toString();
    return {
      ...rest,
      id,
      dueDate: rest.dueDate ? new Date(rest.dueDate) : undefined,
    } as Task;
  }

  async findByUserId(userId: string): Promise<Task[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc) => this.toDomain(doc));
  }

  async findByAudioFileId(audioFileId: string): Promise<Task[]> {
    const docs = await this.collection
      .find({ audioFileId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((doc) => this.toDomain(doc));
  }
}

