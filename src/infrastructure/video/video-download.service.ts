import { exec, spawn } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Readable } from "stream";
import { createReadStream } from "fs";
import { S3AudioStorage } from "../aws/s3.audio.storage";

const execAsync = promisify(exec);

export type VideoSource = "youtube" | "tiktok" | "instagram" | "facebook";

export interface VideoDownloadResult {
  filePath: string;
  filename: string;
  originalTitle?: string; // Original video title from the platform
  videoId?: string; // Video ID from the platform (e.g., YouTube video ID)
  mimeType: string;
  duration?: number;
}

export class VideoDownloadService {
  private static readonly COOKIES_FILE_PATH = "/app/cookies/youtube_cookies.txt";
  private static readonly S3_COOKIES_BUCKET = "syncpoly-youtube-cookies";
  private static readonly S3_COOKIES_KEY = "cookies.txt";
  private s3Storage?: S3AudioStorage;
  private cookiesTempPath?: string;

  constructor(s3Storage?: S3AudioStorage) {
    this.s3Storage = s3Storage;
  }

  /**
   * Downloads cookies from S3 if available, otherwise checks local file system
   * @returns Path to cookies file, or undefined if not found
   */
  private async getCookiesFilePath(): Promise<string | undefined> {
    // First, try to get cookies from S3
    if (this.s3Storage) {
      try {
        const exists = await this.s3Storage.audioExists(
          VideoDownloadService.S3_COOKIES_BUCKET,
          VideoDownloadService.S3_COOKIES_KEY
        );
        
        if (exists) {
          console.log("[VideoDownload] Found cookies in S3, downloading to temp file");
          // Download from S3 to a temp file
          const tempDir = await mkdtemp(join(tmpdir(), "cookies-"));
          const tempFilePath = join(tempDir, "cookies.txt");
          
          const stream = await this.s3Storage.getAudioStream(
            VideoDownloadService.S3_COOKIES_BUCKET,
            VideoDownloadService.S3_COOKIES_KEY
          );
          
          // Read stream into buffer and write to file
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const fileBuffer = Buffer.concat(chunks);
          await writeFile(tempFilePath, fileBuffer);
          
          this.cookiesTempPath = tempFilePath;
          console.log(`[VideoDownload] Downloaded cookies from S3 to ${tempFilePath}`);
          return tempFilePath;
        }
      } catch (error) {
        console.warn(`[VideoDownload] Error checking S3 for cookies: ${error}. Falling back to local file.`);
      }
    }
    
    // Fall back to local file system
    try {
      if (existsSync(VideoDownloadService.COOKIES_FILE_PATH)) {
        console.log("[VideoDownload] Using local YouTube cookies file for yt-dlp");
        return VideoDownloadService.COOKIES_FILE_PATH;
      }
    } catch (error) {
      console.warn(`[VideoDownload] Error checking for local cookies file: ${error}.`);
    }
    
    console.log("[VideoDownload] No YouTube cookies file found. Proceeding without cookies.");
    return undefined;
  }

  /**
   * Gets yt-dlp cookie arguments if the cookies file exists
   * @returns Array of cookie arguments, or empty array if file doesn't exist
   */
  private async getCookieArgs(): Promise<string[]> {
    const cookiesPath = await this.getCookiesFilePath();
    if (cookiesPath) {
      return ["--cookies", cookiesPath];
    }
    return [];
  }

  /**
   * Cleans up temporary cookies file if one was created from S3
   */
  private async cleanupCookiesFile(): Promise<void> {
    if (this.cookiesTempPath) {
      try {
        await unlink(this.cookiesTempPath);
        // Also try to remove the temp directory
        const { dirname } = await import("path");
        const tempDir = dirname(this.cookiesTempPath);
        try {
          const { rm } = await import("fs/promises");
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore errors removing directory
        }
        this.cookiesTempPath = undefined;
      } catch (error) {
        console.warn(`[VideoDownload] Error cleaning up temp cookies file: ${error}`);
      }
    }
  }

  /**
   * Validates and identifies the video source from a URL
   */
  static identifySource(url: string): VideoSource | null {
    const normalizedUrl = url.toLowerCase().trim();
    
    if (normalizedUrl.includes("youtube.com") || normalizedUrl.includes("youtu.be")) {
      return "youtube";
    }
    if (normalizedUrl.includes("tiktok.com")) {
      return "tiktok";
    }
    if (normalizedUrl.includes("instagram.com")) {
      return "instagram";
    }
    if (normalizedUrl.includes("facebook.com") || normalizedUrl.includes("fb.com")) {
      return "facebook";
    }
    
    return null;
  }

  /**
   * Validates that the URL is from a supported platform
   */
  static validateUrl(url: string): { valid: boolean; source?: VideoSource; error?: string } {
    if (!url || typeof url !== "string") {
      return { valid: false, error: "URL is required and must be a string" };
    }

    try {
      new URL(url); // Validate URL format
    } catch {
      return { valid: false, error: "Invalid URL format" };
    }

    const source = this.identifySource(url);
    if (!source) {
      return {
        valid: false,
        error: "Unsupported video source. Supported platforms: YouTube, TikTok, Instagram, Facebook",
      };
    }

    return { valid: true, source };
  }

  /**
   * Downloads a video from a supported platform using yt-dlp
   * @param url The video URL
   * @param onProgress Optional progress callback
   * @returns Video file path and metadata
   */
  async downloadVideo(
    url: string,
    onProgress?: (progress: number) => void
  ): Promise<VideoDownloadResult> {
    const validation = VideoDownloadService.validateUrl(url);
    if (!validation.valid || !validation.source) {
      throw new Error(validation.error || "Invalid video URL");
    }

    // Create temporary directory for download
    const tempDir = await mkdtemp(join(tmpdir(), "video-download-"));
    const outputTemplate = join(tempDir, "%(title)s.%(ext)s");

    try {
      // Check if yt-dlp is available
      try {
        await execAsync("yt-dlp --version");
      } catch {
        throw new Error(
          "yt-dlp is not installed. Please install it: https://github.com/yt-dlp/yt-dlp#installation"
        );
      }

      // First, get video metadata (title and ID) without downloading
      let originalTitle: string | undefined;
      let videoId: string | undefined;
      try {
        // Get cookie arguments if cookies file exists
        const cookieArgs = await this.getCookieArgs();
        
        // Build metadata command with optional cookies
        // Use spawn-like approach but with execAsync for simplicity
        const metadataArgs = [
          "--no-playlist",
          "--dump-json",
          "--no-warnings",
          ...cookieArgs,
          url,
        ];
        
        // Construct command string, properly escaping each argument
        const metadataCmd = `yt-dlp ${metadataArgs.map(arg => {
          // Escape quotes and special characters in arguments
          if (arg.includes(" ") || arg.includes('"') || arg.includes("'")) {
            return `"${arg.replace(/"/g, '\\"')}"`;
          }
          return arg;
        }).join(" ")}`;
        
        const { stdout: metadataOutput } = await execAsync(metadataCmd, {
          maxBuffer: 10 * 1024 * 1024,
        });
        const metadata = JSON.parse(metadataOutput);
        originalTitle = metadata.title || metadata.fulltitle || undefined;
        videoId = metadata.id || metadata.display_id || undefined;
        
        if (originalTitle) {
          // Sanitize title for filename (remove invalid characters)
          originalTitle = originalTitle.replace(/[<>:"/\\|?*]/g, "").trim();
          console.log(`[VideoDownload] Original video title: ${originalTitle}`);
        }
        if (videoId) {
          console.log(`[VideoDownload] Video ID: ${videoId}`);
        }
      } catch (error) {
        console.warn(`[VideoDownload] Could not extract video metadata:`, error);
      }

      // Download video with best quality audio/video
      // Use format that combines best video and audio, or best available
      console.log(`[VideoDownload] Downloading from ${validation.source}: ${url}`);
      
      // Get cookie arguments if cookies file exists
      const cookieArgs = await this.getCookieArgs();
      
      // Use spawn to capture real-time progress output
      await new Promise<void>((resolve, reject) => {
        const args = [
          "--no-playlist",
          "--format",
          "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
          "--output",
          outputTemplate,
          "--no-warnings",
          "--newline", // Output progress on new lines
          ...cookieArgs, // Add cookies args if file exists
          url,
        ];

        const downloadProcess = spawn("yt-dlp", args);
        let lastProgress = 0;

        downloadProcess.stdout.on("data", (data: Buffer) => {
          const output = data.toString();
          // Parse yt-dlp progress output
          // Format: [download] 45.2% of 123.45MiB at 1.23MiB/s ETA 00:42
          const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]);
            if (!isNaN(progress) && progress !== lastProgress) {
              lastProgress = progress;
              if (onProgress) {
                onProgress(progress);
              }
            }
          }
        });

        downloadProcess.stderr.on("data", (data: Buffer) => {
          const output = data.toString();
          // yt-dlp also outputs progress to stderr
          const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]);
            if (!isNaN(progress) && progress !== lastProgress) {
              lastProgress = progress;
              if (onProgress) {
                onProgress(progress);
              }
            }
          }
        });

        downloadProcess.on("close", (code) => {
          if (code === 0) {
            // Ensure we report 100% completion
            if (onProgress && lastProgress < 100) {
              onProgress(100);
            }
            resolve();
          } else {
            reject(new Error(`yt-dlp exited with code ${code}`));
          }
        });

        downloadProcess.on("error", (error) => {
          reject(error);
        });
      });

      // Find the downloaded file
      const files = await import("fs/promises").then(fs => fs.readdir(tempDir));
      if (files.length === 0) {
        throw new Error("Video download failed: No file was downloaded");
      }

      // Get the downloaded file (should be the only one)
      const downloadedFile = files[0];
      const filePath = join(tempDir, downloadedFile);

      // Get video metadata using ffprobe
      // Use spawn instead of execAsync to properly handle file paths with special characters
      let duration: number | undefined;
      try {
        const probeArgs = [
          "-v", "error",
          "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1",
          filePath, // Pass file path directly as argument, no shell interpretation
        ];
        
        const probeProcess = spawn("ffprobe", probeArgs);
        let stdout = "";
        let stderr = "";
        
        probeProcess.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        
        probeProcess.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        
        await new Promise<void>((resolve, reject) => {
          probeProcess.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
            }
          });
          
          probeProcess.on("error", (error) => {
            reject(error);
          });
        });
        
        duration = parseFloat(stdout.trim()) || undefined;
      } catch (error) {
        console.warn(`[VideoDownload] Could not determine video duration:`, error);
      }

      // Determine MIME type based on file extension
      const mimeType = this.getMimeTypeFromFilename(downloadedFile);

      console.log(`[VideoDownload] Successfully downloaded: ${downloadedFile} (${duration ? duration.toFixed(2) + "s" : "unknown duration"})`);

      // Clean up cookies temp file after successful download
      await this.cleanupCookiesFile();

      return {
        filePath,
        filename: downloadedFile,
        originalTitle,
        videoId,
        mimeType,
        duration,
      };
    } catch (error: any) {
      // Clean up temp directory on error
      try {
        await this.cleanupTempDir(tempDir);
      } catch (cleanupError) {
        console.error(`[VideoDownload] Error cleaning up temp directory:`, cleanupError);
      }
      
      // Clean up cookies temp file on error
      await this.cleanupCookiesFile();

      if (error.message.includes("yt-dlp is not installed")) {
        throw error;
      }

      throw new Error(`Failed to download video: ${error.message || "Unknown error"}`);
    }
  }

  /**
   * Reads a video file into a buffer
   */
  async readVideoFile(filePath: string): Promise<Buffer> {
    const fs = await import("fs/promises");
    return await fs.readFile(filePath);
  }

  /**
   * Creates a readable stream from a video file
   */
  createVideoStream(filePath: string): Readable {
    return createReadStream(filePath);
  }

  /**
   * Cleans up temporary directory and files
   */
  async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      const fs = await import("fs/promises");
      const files = await fs.readdir(tempDir);
      
      for (const file of files) {
        await fs.unlink(join(tempDir, file)).catch(() => {});
      }
      
      await fs.rmdir(tempDir).catch(() => {});
    } catch (error) {
      console.error(`[VideoDownload] Error cleaning up temp directory:`, error);
    }
  }

  /**
   * Determines MIME type from filename extension
   */
  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp4: "video/mp4",
      mkv: "video/x-matroska",
      webm: "video/webm",
      avi: "video/x-msvideo",
      mov: "video/quicktime",
      m4v: "video/x-m4v",
    };
    return mimeTypes[ext || ""] || "video/mp4";
  }
}

