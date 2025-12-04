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

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit for videos
  },
  fileFilter: (_req, file, cb) => {
    // Accept video files
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
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

  // Get all audio files for the authenticated user
  router.get("/", (req, res) => audioController.getAudioFiles(req as any, res));

  // Upload audio file
  router.post(
    "/upload",
    upload.single("file"),
    (req, res) => audioController.uploadAudio(req as any, res)
  );

  // Upload video file (converts to MP3)
  router.post(
    "/upload/video",
    uploadVideo.single("file"),
    (req, res) => audioController.uploadVideo(req as any, res)
  );

  // Process audio
  router.post("/process", (req, res) => audioController.processAudio(req as any, res));

  // Get memory usage
  router.get("/memory/:userId", (req, res) => audioController.getMemoryUsage(req as any, res));

  // Calculate usage period (requires startDate and endDate query params)
  router.get("/usage/period", (req, res) => audioController.calculateUsagePeriod(req as any, res));

  // Get incomplete upload jobs (paginated, default 5 per page)
  // Must come before /upload/:jobId/progress to avoid route conflicts
  router.get("/upload/jobs/incomplete", (req, res) => audioController.getIncompleteUploadJobs(req as any, res));

  // Get upload progress
  router.get("/upload/:jobId/progress", (req, res) => audioController.getUploadProgress(req as any, res));

  // Get processing progress
  router.get("/process/:jobId/progress", (req, res) => audioController.getProcessingProgress(req as any, res));

  // Get all processing jobs for the user (from past day)
  router.get("/process/jobs", (req, res) => audioController.getProcessingJobs(req as any, res));

  // Get transcript for an audio file
  router.get("/:audioFileId/transcript", (req, res) => audioController.getTranscript(req as any, res));

  // Update transcript by transcript ID
  router.patch("/transcript/:transcriptId", (req, res) => audioController.updateTranscript(req as any, res));

  // Generate breakdown for an audio file (all chunks or specific orderIndex)
  router.post("/:audioFileId/breakdown/generate", (req, res) => audioController.generateBreakdown(req as any, res));

  // Get all breakdowns for an audio file
  router.get("/:audioFileId/breakdowns", (req, res) => audioController.getBreakdowns(req as any, res));

  // CRUD endpoints for breakdown
  router.post("/:audioFileId/breakdown", (req, res) => audioController.createBreakdown(req as any, res));
  router.get("/breakdown/:breakdownId", (req, res) => audioController.getBreakdown(req as any, res));
  router.put("/breakdown/:breakdownId", (req, res) => audioController.updateBreakdown(req as any, res));
  router.delete("/breakdown/:breakdownId", (req, res) => audioController.deleteBreakdown(req as any, res));

  // Chat endpoint
  router.post("/chat", (req, res) => chatController.chat(req as any, res));

  // Get chat messages by audio file ID
  router.get("/:audioFileId/chat/messages", (req, res) => chatController.getMessagesByAudioId(req as any, res));

  return router;
}

