export type QuestionType = "true-false" | "multiple-choice" | "short-answer";

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect?: boolean; // For multiple choice and true/false
}

export interface Question {
  id: string;
  userId: string;
  audioFileId?: string; // Optional: if question is related to a specific audio file
  type: QuestionType;
  question: string; // The question text
  options?: QuestionOption[]; // Required for multiple-choice, optional for others
  correctAnswer?: string; // For short-answer or as reference
  explanation?: string; // Optional explanation or context
  createdAt: Date;
  updatedAt: Date;
}



