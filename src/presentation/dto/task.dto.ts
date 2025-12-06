import { Task } from "../../domain/entities/task";

export interface TaskResponse {
  id: string;
  userId: string;
  audioFileId?: string;
  description: string;
  dueDate?: Date;
  priority?: "low" | "medium" | "high";
  location?: string;
  status: "pending" | "in-progress" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateTaskStatusRequest {
  status: "pending" | "in-progress" | "completed";
}

export interface TasksResponse {
  tasks: TaskResponse[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function toTaskResponse(task: Task): TaskResponse {
  return {
    id: task.id,
    userId: task.userId,
    audioFileId: task.audioFileId,
    description: task.description,
    dueDate: task.dueDate,
    priority: task.priority,
    location: task.location,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

