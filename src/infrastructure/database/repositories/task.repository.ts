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

  async findByAudioFileIdPaginated(
    audioFileId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ tasks: Task[]; total: number; page: number; limit: number; totalPages: number }> {
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
    
    const tasks = docs.map((doc: Record<string, any>) => this.toDomain(doc));
    const totalPages = Math.ceil(total / limit);
    
    return {
      tasks,
      total,
      page,
      limit,
      totalPages,
    };
  }
}

