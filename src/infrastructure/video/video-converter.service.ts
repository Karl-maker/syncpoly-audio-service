import { Readable } from "stream";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const execAsync = promisify(exec);

export interface VideoConversionOptions {
  onProgress?: (progress: number) => void;
}

export class VideoConverterService {
  /**
   * Convert video buffer to MP3 audio buffer
   * @param videoBuffer - Video file buffer
   * @param options - Conversion options including progress callback
   * @returns MP3 audio buffer
   */
  async convertVideoToMp3(
    videoBuffer: Buffer,
    options?: VideoConversionOptions
  ): Promise<Buffer> {
    const tempDir = tmpdir();
    const videoId = randomUUID();
    const inputPath = join(tempDir, `${videoId}-input`);
    const outputPath = join(tempDir, `${videoId}-output.mp3`);

    try {
      // Write video buffer to temporary file
      options?.onProgress?.(10); // 10% - writing temp file
      await writeFile(inputPath, videoBuffer);

      // Check if ffmpeg is available
      try {
        await execAsync("ffmpeg -version");
      } catch (error) {
        throw new Error(
          "ffmpeg is not installed or not available in PATH. Please install ffmpeg to convert videos."
        );
      }

      // Convert video to MP3 using ffmpeg
      options?.onProgress?.(20); // 20% - starting conversion
      // Use array format for exec to avoid shell injection and handle paths with special characters
      const ffmpegArgs = [
        "-i", inputPath,
        "-vn", // No video
        "-acodec", "libmp3lame", // MP3 codec
        "-ab", "192k", // Audio bitrate
        "-ar", "44100", // Sample rate
        "-y", // Overwrite output file
        outputPath
      ];
      
      await execAsync(`ffmpeg ${ffmpegArgs.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(" ")}`);
      options?.onProgress?.(90); // 90% - conversion complete

      // Read MP3 file
      const mp3Buffer = await readFile(outputPath);
      options?.onProgress?.(100); // 100% - done

      return mp3Buffer;
    } catch (error: any) {
      console.error("[VideoConverterService] Error converting video:", error);
      throw new Error(`Video conversion failed: ${error.message || "Unknown error"}`);
    } finally {
      // Clean up temporary files
      try {
        await unlink(inputPath).catch(() => {
          // Ignore errors if file doesn't exist
        });
        await unlink(outputPath).catch(() => {
          // Ignore errors if file doesn't exist
        });
      } catch (cleanupError) {
        console.warn("[VideoConverterService] Failed to clean up temp files:", cleanupError);
      }
    }
  }

  /**
   * Check if a file is a video based on MIME type
   */
  isVideoFile(mimeType: string): boolean {
    return mimeType.startsWith("video/");
  }
}

