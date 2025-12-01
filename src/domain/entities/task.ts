export interface Task {
  id: string;
  userId: string;
  audioFileId?: string; // Optional: if task is related to a specific audio file
  description: string;
  dueDate?: Date; // Optional: if due date is mentioned
  priority?: "low" | "medium" | "high"; // Optional: inferred priority
  status: "pending" | "in-progress" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

