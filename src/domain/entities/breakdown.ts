import { Task } from "./task";
import { Question } from "./question";

export interface Breakdown {
  id: string;
  userId: string;
  audioFileId: string;
  orderIndex?: number; // Optional: for sorting multiple breakdowns per audio file (default: 0)
  introduction: string;
  bulletPoints: string[];
  mainTakeaways: string[];
  actionItems: Task[]; // References to tasks
  questions: Question[]; // References to questions
  createdAt: Date;
  updatedAt: Date;
}

