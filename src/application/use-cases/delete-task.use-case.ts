import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";

export interface DeleteTaskUseCaseParams {
  taskId: string;
  userId: string;
}

export class DeleteTaskUseCase {
  constructor(private taskRepository: TaskRepository) {}

  async execute(params: DeleteTaskUseCaseParams): Promise<void> {
    const { taskId, userId } = params;

    // Find the task
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Verify task belongs to user
    if (task.userId !== userId) {
      throw new Error("Unauthorized: Task does not belong to user");
    }

    // Delete the task
    await this.taskRepository.delete(taskId);
  }
}

