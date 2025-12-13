import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/jwt.middleware";
import { ChatUseCase } from "../../application/use-cases/chat.use-case";
import { ChatMessageRepository } from "../../infrastructure/database/repositories/chat-message.repository";

export class ChatController {
  constructor(
    private chatUseCase: ChatUseCase,
    private chatMessageRepository: ChatMessageRepository
  ) {}

  async chat(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { message, audioFileId, audioFileIds, topK } = req.body;

      if (!message || typeof message !== "string") {
        res.status(400).json({ error: "message is required and must be a string" });
        return;
      }

      // Set up SSE headers for streaming
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

      // Stream the response
      try {
        let fullResponse = "";
        for await (const chunk of this.chatUseCase.execute({
          userId: req.user.userId,
          message,
          audioFileId, // Backwards compatible: single audioFileId
          audioFileIds, // New: multiple audioFileIds
          topK: topK || 10, // Default to 10 for better results
        })) {
          // Handle both string chunks and structured objects
          if (typeof chunk === "string") {
            fullResponse += chunk;
            // Send chunk as SSE
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          } else {
            // Structured object (tasks/questions) - send as special event
            res.write(`data: ${JSON.stringify({ objects: chunk })}\n\n`);
          }
        }

        // After streaming completes, extract and send structured objects
        try {
          // Check if user explicitly requested questions
          const questionKeywords = [
            "generate questions", "create questions", "make questions", "quiz questions",
            "test questions", "test me", "quiz me", "questions about", "questions for",
            "practice questions", "study questions", "review questions", "questions to test"
          ];
          
          // Check if user explicitly requested tasks
          const taskKeywords = [
            "extract tasks", "create tasks", "make tasks", "action items", "homework",
            "tasks from", "tasks in", "what tasks", "what homework", "what action items",
            "list tasks", "list homework", "list action items", "get tasks", "get homework"
          ];
          
          const userMessageLower = message.toLowerCase();
          const shouldExtractQuestions = questionKeywords.some(keyword => userMessageLower.includes(keyword));
          const shouldExtractTasks = taskKeywords.some(keyword => userMessageLower.includes(keyword));

          // Use first audioFileId for extraction (backwards compatible)
          const targetAudioFileId = audioFileIds && audioFileIds.length > 0 
            ? audioFileIds[0] 
            : audioFileId;
          const extracted = await this.chatUseCase.getExtractedObjects(
            fullResponse,
            req.user.userId,
            targetAudioFileId,
            shouldExtractQuestions,
            shouldExtractTasks
          );
          
          if (extracted.tasks.length > 0 || extracted.questions.length > 0) {
            res.write(
              `data: ${JSON.stringify({ 
                objects: { 
                  tasks: extracted.tasks, 
                  questions: extracted.questions 
                } 
              })}\n\n`
            );
          }
        } catch (error) {
          // Silently fail - extraction is non-critical
          console.error("[ChatController] Error extracting objects:", error);
        }

        // Send completion signal
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (error: any) {
        // Send error as SSE
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to process chat request" });
      }
    }
  }

  async getMessagesByAudioId(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { audioFileId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

      if (!audioFileId) {
        res.status(400).json({ error: "audioFileId is required" });
        return;
      }

      if (isNaN(limit) || limit < 1 || limit > 1000) {
        res.status(400).json({ error: "limit must be a number between 1 and 1000" });
        return;
      }

      const messages = await this.chatMessageRepository.getMessagesByAudioFileId(
        req.user.userId,
        audioFileId,
        limit
      );

      res.json({ messages });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to retrieve chat messages" });
    }
  }

  async findMentions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { term, audioFileId, audioFileIds, topK, all } = req.body;

      if (!term || typeof term !== "string" || term.trim().length === 0) {
        res.status(400).json({ error: "term is required and must be a non-empty string" });
        return;
      }

      const mentions = await this.chatUseCase.findMentions({
        userId: req.user.userId,
        term: term.trim(),
        audioFileId,
        audioFileIds,
        topK: topK || 50,
        all: all === true, // Default to false if not provided
      });

      res.json(mentions);
    } catch (error: any) {
      if (error.message?.includes("not found") || error.message?.includes("not authorized")) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to find mentions" });
    }
  }
}

