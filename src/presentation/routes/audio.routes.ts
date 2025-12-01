import { Router } from "express";
import multer from "multer";
import { AudioController } from "../controllers/audio.controller";
import { ChatController } from "../controllers/chat.controller";
import { jwtMiddleware } from "../middleware/jwt.middleware";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

export function createAudioRoutes(
  audioController: AudioController,
  chatController: ChatController
): Router {
  const router = Router();

  // All routes require authentication
  router.use(jwtMiddleware);

  // Upload audio file
  router.post(
    "/upload",
    upload.single("file"),
    (req, res) => audioController.uploadAudio(req as any, res)
  );

  // Process audio
  router.post("/process", (req, res) => audioController.processAudio(req as any, res));

  // Get memory usage
  router.get("/memory/:userId", (req, res) => audioController.getMemoryUsage(req as any, res));

  // Chat endpoint
  router.post("/chat", (req, res) => chatController.chat(req as any, res));

  return router;
}

