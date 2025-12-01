import { Breakdown } from "../../domain/entities/breakdown";
import { Task } from "../../domain/entities/task";
import { Question } from "../../domain/entities/question";

export interface GenerateBreakdownRequest {
  audioFileId: string;
}

export interface CreateBreakdownRequest {
  audioFileId: string;
  introduction: string;
  bulletPoints: string[];
  mainTakeaways: string[];
  actionItemIds?: string[]; // Optional: IDs of existing tasks
  questionIds?: string[]; // Optional: IDs of existing questions
}

export interface UpdateBreakdownRequest {
  introduction?: string;
  bulletPoints?: string[];
  mainTakeaways?: string[];
  actionItemIds?: string[]; // Optional: IDs of existing tasks
  questionIds?: string[]; // Optional: IDs of existing questions
}

export interface BreakdownResponse {
  id: string;
  audioFileId: string;
  orderIndex?: number;
  introduction: string;
  bulletPoints: string[];
  mainTakeaways: string[];
  actionItems: Array<{
    id: string;
    description: string;
    dueDate?: Date;
    priority?: "low" | "medium" | "high";
    status: "pending" | "in-progress" | "completed";
  }>;
  questions: Array<{
    id: string;
    type: "true-false" | "multiple-choice" | "short-answer";
    question: string;
    options?: Array<{
      id: string;
      text: string;
      isCorrect?: boolean;
    }>;
    correctAnswer?: string;
    explanation?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export function toBreakdownResponse(breakdown: Breakdown): BreakdownResponse {
  return {
    id: breakdown.id,
    audioFileId: breakdown.audioFileId,
    orderIndex: breakdown.orderIndex,
    introduction: breakdown.introduction,
    bulletPoints: breakdown.bulletPoints,
    mainTakeaways: breakdown.mainTakeaways,
    actionItems: breakdown.actionItems.map((task) => ({
      id: task.id,
      description: task.description,
      dueDate: task.dueDate,
      priority: task.priority,
      status: task.status,
    })),
    questions: breakdown.questions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    })),
    createdAt: breakdown.createdAt,
    updatedAt: breakdown.updatedAt,
  };
}
