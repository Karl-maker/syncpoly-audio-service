import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";
import { Task } from "../../domain/entities/task";

export interface UpdateTaskStatusUseCaseParams {
  taskId: string;
  userId: string;
  status: "pending" | "in-progress" | "completed";
}

export class UpdateTaskStatusUseCase {
  constructor(private taskRepository: TaskRepository) {}

  async execute(params: UpdateTaskStatusUseCaseParams): Promise<Task> {
    const { taskId, userId, status } = params;

    // Find the task
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Verify task belongs to user
    if (task.userId !== userId) {
      throw new Error("Unauthorized: Task does not belong to user");
    }

    // Update task status
    const updatedTask = await this.taskRepository.update(taskId, {
      status,
    } as Partial<Task>);

    if (!updatedTask) {
      throw new Error(`Failed to update task: ${taskId}`);
    }

    return updatedTask;
  }
}

