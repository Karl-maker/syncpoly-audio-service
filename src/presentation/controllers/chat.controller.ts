import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/jwt.middleware";
import { ChatUseCase } from "../../application/use-cases/chat.use-case";

export class ChatController {
  constructor(private chatUseCase: ChatUseCase) {}

  async chat(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { message, audioFileId, topK } = req.body;

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
          audioFileId,
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
          const extracted = await this.chatUseCase.getExtractedObjects(
            fullResponse,
            req.user.userId,
            audioFileId
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
}

