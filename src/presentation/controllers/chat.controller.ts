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
        for await (const chunk of this.chatUseCase.execute({
          userId: req.user.userId,
          message,
          audioFileId,
          topK: topK || 5,
        })) {
          // Send chunk as SSE
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
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

