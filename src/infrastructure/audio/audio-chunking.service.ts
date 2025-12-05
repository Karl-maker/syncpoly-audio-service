import { Readable } from "stream";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const execAsync = promisify(exec);

export interface AudioChunk {
  buffer: Buffer;
  partIndex: number;
  startTimeSec: number;
  endTimeSec: number;
}

export interface AudioChunkingOptions {
  chunkDurationSec?: number; // Duration of each chunk in seconds (default: 30 minutes)
  chunkSizeBytes?: number; // Alternative: chunk by size in bytes (default: 100MB)
  onProgress?: (progress: number, partIndex: number) => void;
}

/**
 * Service for chunking large audio/video files into smaller parts.
 * Uses ffmpeg to split files by duration or size.
 */
export class AudioChunkingService {
  // OpenAI transcription API limit: 25MB, we use 24MB for safety margin
  public static readonly OPENAI_MAX_SIZE_BYTES = 24 * 1024 * 1024; // 24MB
  // Default chunk size: 100MB (for upload efficiency)
  private readonly DEFAULT_CHUNK_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
  // Default chunk duration: 30 minutes (for processing efficiency)
  private readonly DEFAULT_CHUNK_DURATION_SEC = 30 * 60; // 30 minutes

  /**
   * Chunk an audio/video file buffer into multiple parts.
   * @param fileBuffer - The audio/video file buffer
   * @param mimeType - MIME type of the file
   * @param options - Chunking options
   * @returns Array of audio chunks
   */
  async chunkAudioFile(
    fileBuffer: Buffer,
    mimeType: string,
    options?: AudioChunkingOptions
  ): Promise<AudioChunk[]> {
    const tempDir = tmpdir();
    const fileId = randomUUID();
    const inputPath = join(tempDir, `${fileId}-input`);
    const chunks: AudioChunk[] = [];

    try {
      // Check if ffmpeg is available
      try {
        await execAsync("ffmpeg -version");
      } catch (error) {
        throw new Error(
          "ffmpeg is not installed or not available in PATH. Please install ffmpeg to chunk audio files."
        );
      }

      // Write input file
      options?.onProgress?.(0, 0);
      await writeFile(inputPath, fileBuffer);

      // Get file duration using ffprobe
      const probeCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
      let durationSec: number;
      try {
        const { stdout } = await execAsync(probeCommand);
        durationSec = parseFloat(stdout.trim()) || 0;
      } catch (error) {
        console.warn("[AudioChunkingService] Could not determine duration, using size-based chunking");
        durationSec = 0;
      }

      // Determine chunking strategy
      const chunkDurationSec = options?.chunkDurationSec || this.DEFAULT_CHUNK_DURATION_SEC;
      const chunkSizeBytes = options?.chunkSizeBytes || this.DEFAULT_CHUNK_SIZE_BYTES;
      
      // If chunkSizeBytes is explicitly provided, ALWAYS use size-based chunking
      // This ensures strict size control (e.g., 10MB chunks for OpenAI)
      // Only use duration-based if chunkSizeBytes is NOT provided
      const useDurationBased = !options?.chunkSizeBytes && durationSec > 0 && durationSec > chunkDurationSec;
      
      if (useDurationBased) {
        // Duration-based chunking
        const totalChunks = Math.ceil(durationSec / chunkDurationSec);
        console.log(`[AudioChunkingService] Chunking by duration: ${totalChunks} chunks of ${chunkDurationSec}s each`);

        for (let i = 0; i < totalChunks; i++) {
          const startTime = i * chunkDurationSec;
          const endTime = Math.min((i + 1) * chunkDurationSec, durationSec);
          const outputPath = join(tempDir, `${fileId}-chunk-${i}.mp3`);

          // Extract chunk using ffmpeg
          const ffmpegArgs = [
            "-i", inputPath,
            "-ss", startTime.toString(),
            "-t", (endTime - startTime).toString(),
            "-acodec", "libmp3lame",
            "-ab", "192k",
            "-ar", "44100",
            "-y",
            outputPath
          ];

          await execAsync(`ffmpeg ${ffmpegArgs.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(" ")}`);

          const chunkBuffer = await readFile(outputPath);
          chunks.push({
            buffer: chunkBuffer,
            partIndex: i,
            startTimeSec: startTime,
            endTimeSec: endTime,
          });

          // Report progress: (i + 1) / totalChunks, but cap at 99% to leave room for final completion
          const chunkProgress = Math.min(((i + 1) / totalChunks * 100), 99);
          options?.onProgress?.(chunkProgress, i);
          await unlink(outputPath).catch(() => {});
        }
      } else {
        // Size-based chunking - use ffmpeg to extract chunks by size
        // This ensures valid audio files (can't just slice MP3 at arbitrary bytes)
        console.log(`[AudioChunkingService] Chunking by size: target ${chunkSizeBytes} bytes per chunk`);

        // First, convert to a consistent audio format if needed
        let audioPath = inputPath;
        if (mimeType.startsWith("video/") || !mimeType.includes("audio/mpeg")) {
          // Convert to MP3 first
          audioPath = join(tempDir, `${fileId}-audio.mp3`);
          const convertArgs = [
            "-i", inputPath,
            "-vn",
            "-acodec", "libmp3lame",
            "-ab", "192k", // 192kbps bitrate
            "-ar", "44100",
            "-y",
            audioPath
          ];
          await execAsync(`ffmpeg ${convertArgs.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(" ")}`);
        }

        // Get the converted audio file size
        const audioBuffer = await readFile(audioPath);
        const totalChunks = Math.ceil(audioBuffer.length / chunkSizeBytes);
        console.log(`[AudioChunkingService] Audio file size: ${audioBuffer.length} bytes, creating ${totalChunks} chunks`);

        // Use ffmpeg to extract chunks by duration that approximate the target size
        // Calculate approximate duration per chunk based on bitrate
        // For 192kbps MP3: 10MB = ~7 minutes
        // Formula: duration_sec = (size_bytes * 8) / (bitrate_bps)
        const bitrateBps = 192 * 1000; // 192kbps = 192000 bps
        const targetDurationSec = (chunkSizeBytes * 8) / bitrateBps;
        
        // Get actual duration of the audio file
        let actualDurationSec = durationSec;
        if (actualDurationSec === 0) {
          try {
            const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
            const { stdout } = await execAsync(probeCmd);
            actualDurationSec = parseFloat(stdout.trim()) || 0;
          } catch (error) {
            console.warn("[AudioChunkingService] Could not determine audio duration, using estimated duration");
            // Estimate: assume 192kbps
            actualDurationSec = (audioBuffer.length * 8) / bitrateBps;
          }
        }

        // Extract chunks using ffmpeg by duration (which approximates size)
        const chunksByDuration = Math.ceil(actualDurationSec / targetDurationSec);
        console.log(`[AudioChunkingService] Extracting ${chunksByDuration} chunks of ~${targetDurationSec.toFixed(1)}s each`);

        for (let i = 0; i < chunksByDuration; i++) {
          const startTime = i * targetDurationSec;
          const chunkDuration = Math.min(targetDurationSec, actualDurationSec - startTime);
          const outputPath = join(tempDir, `${fileId}-chunk-${i}.mp3`);

          // Extract chunk using ffmpeg
          const ffmpegArgs = [
            "-i", audioPath,
            "-ss", startTime.toString(),
            "-t", chunkDuration.toString(),
            "-acodec", "libmp3lame",
            "-ab", "192k",
            "-ar", "44100",
            "-y",
            outputPath
          ];

          await execAsync(`ffmpeg ${ffmpegArgs.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(" ")}`);

          const chunkBuffer = await readFile(outputPath);
          
          // STRICT SIZE ENFORCEMENT: Verify chunk size is under target
          if (chunkBuffer.length > chunkSizeBytes) {
            console.warn(`[AudioChunkingService] Chunk ${i} size ${chunkBuffer.length} bytes exceeds target ${chunkSizeBytes} bytes, re-extracting with shorter duration...`);
            
            // Calculate a more conservative duration to ensure we stay under the size limit
            // Use 95% of target to ensure we're safely under
            const safeSizeBytes = chunkSizeBytes * 0.95;
            const adjustedDuration = (safeSizeBytes * 8) / bitrateBps;
            
            await unlink(outputPath).catch(() => {});
            
            // Re-extract with shorter duration
            const adjustedArgs = [
              "-i", audioPath,
              "-ss", startTime.toString(),
              "-t", Math.min(adjustedDuration, chunkDuration).toString(),
              "-acodec", "libmp3lame",
              "-ab", "192k",
              "-ar", "44100",
              "-y",
              outputPath
            ];
            await execAsync(`ffmpeg ${adjustedArgs.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(" ")}`);
            const adjustedBuffer = await readFile(outputPath);
            
            // Final check - if still too large, we have a problem
            if (adjustedBuffer.length > chunkSizeBytes) {
              throw new Error(`[AudioChunkingService] Unable to create chunk ${i} under ${chunkSizeBytes} bytes. Final size: ${adjustedBuffer.length} bytes. Audio bitrate may be too high.`);
            }
            
            console.log(`[AudioChunkingService] Chunk ${i} final size: ${adjustedBuffer.length} bytes (target: ${chunkSizeBytes} bytes)`);
            chunks.push({
              buffer: adjustedBuffer,
              partIndex: i,
              startTimeSec: startTime,
              endTimeSec: startTime + Math.min(adjustedDuration, chunkDuration),
            });
          } else {
            console.log(`[AudioChunkingService] Chunk ${i} size: ${chunkBuffer.length} bytes (target: ${chunkSizeBytes} bytes) ✓`);
            chunks.push({
              buffer: chunkBuffer,
              partIndex: i,
              startTimeSec: startTime,
              endTimeSec: startTime + chunkDuration,
            });
          }

          // Report progress: (i + 1) / totalChunks, but cap at 99% to leave room for final completion
          const chunkProgress = Math.min(((i + 1) / chunksByDuration * 100), 99);
          options?.onProgress?.(chunkProgress, i);
          await unlink(outputPath).catch(() => {});
        }

        // Clean up converted audio file if we created it
        if (audioPath !== inputPath) {
          await unlink(audioPath).catch(() => {});
        }
      }

      // Don't report 100% here - chunking is complete but upload hasn't started yet
      // The upload phase will handle progress reporting
      return chunks;
    } catch (error: any) {
      console.error("[AudioChunkingService] Error chunking audio:", error);
      throw new Error(`Audio chunking failed: ${error.message || "Unknown error"}`);
    } finally {
      // Clean up temporary files
      try {
        await unlink(inputPath).catch(() => {});
      } catch (cleanupError) {
        console.warn("[AudioChunkingService] Failed to clean up temp file:", cleanupError);
      }
    }
  }

  /**
   * Check if a file should be chunked based on its size.
   * @param fileSize - Size of the file in bytes
   * @param thresholdBytes - Threshold in bytes (default: 100MB)
   * @returns True if file should be chunked
   */
  shouldChunkFile(fileSize: number, thresholdBytes: number = this.DEFAULT_CHUNK_SIZE_BYTES): boolean {
    return fileSize > thresholdBytes;
  }
}

