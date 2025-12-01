import OpenAI from "openai";
import { randomUUID } from "crypto";
import streamToBuffer from "stream-to-array";
import { ITranscriptionProvider, TranscriptionOptions } from "../../domain/interfaces/itranscription.provider";
import { Speaker, Transcript, TranscriptSegment } from "../../domain/entities/transcript";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";

export class OpenAITranscriptionProvider implements ITranscriptionProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribeAudio(
    audio: NodeJS.ReadableStream,
    audioSourceId: string,
    audioSourceProvide: AudioSourceProvidersType,
    options?: TranscriptionOptions
  ): Promise<Transcript> {
    console.log(`[OpenAITranscriptionProvider] Starting transcription for: ${audioSourceId}`);
    
    try {
      // Convert stream to buffer
      const buffers = await streamToBuffer(audio as any);
      const audioBuffer = Buffer.concat(buffers as Buffer[]);
      
      console.log(`[OpenAITranscriptionProvider] Audio buffer size: ${audioBuffer.length} bytes`);

      if (audioBuffer.length === 0) {
        throw new Error("Audio buffer is empty - file may be corrupted or empty");
      }

      // Determine file extension and MIME type from options or defaults
      const filename = options?.filename || "audio.wav";
      const mimeType = options?.mimeType || "audio/wav";
      
      // Detect file type from buffer if not provided
      let detectedMimeType = mimeType;
      if (audioBuffer.length >= 4) {
        // Check magic bytes for common audio formats
        const header = audioBuffer.slice(0, 4);
        if (header[0] === 0xFF && header[1] === 0xFB) {
          detectedMimeType = "audio/mpeg";
        } else if (header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
          detectedMimeType = "audio/ogg";
        } else if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
          detectedMimeType = "audio/wav";
        } else if (header[0] === 0x66 && header[1] === 0x4C && header[2] === 0x61 && header[3] === 0x43) {
          detectedMimeType = "audio/flac";
        }
      }

      console.log(`[OpenAITranscriptionProvider] Using filename: ${filename}, MIME type: ${detectedMimeType}`);

      // Create File object for OpenAI API
      // OpenAI SDK expects a File-like object or a Blob
      // In Node.js 18+, File is available globally
      let file: File | Blob;
      
      if (typeof File !== "undefined") {
        // Node.js 18+ has File globally
        file = new File([audioBuffer], filename, { 
          type: detectedMimeType 
        });
      } else if (typeof Blob !== "undefined") {
        // Fallback to Blob if File is not available
        file = new Blob([audioBuffer], { 
          type: detectedMimeType 
        });
      } else {
        // Last resort: use the buffer directly (OpenAI SDK should handle this)
        file = audioBuffer as any;
      }
      
      console.log(`[OpenAITranscriptionProvider] File object created, type: ${file.constructor.name}`);

      console.log(`[OpenAITranscriptionProvider] Created file object, calling OpenAI API...`);

      // Call OpenAI transcription API with correct model
      const response = await this.client.audio.transcriptions.create({
        model: "whisper-1", // Correct model name
        file: file,
        response_format: "verbose_json", // Get detailed response with timestamps
        timestamp_granularities: ["segment"], // Get segment-level timestamps
      });

      console.log(`[OpenAITranscriptionProvider] Transcription response received`);

      // OpenAI's verbose_json format returns:
      // - text: full transcript
      // - language: detected language
      // - segments: array of segments with start, end, text
      const segments: TranscriptSegment[] = (response.segments || []).map((seg: any, index: number) => ({
        id: seg.id ?? `seg_${index}`,
        text: seg.text || "",
        startTimeSec: seg.start ?? 0,
        endTimeSec: seg.end ?? 0,
        speakerId: seg.speaker || "speaker_1", // OpenAI doesn't provide speaker diarization by default
      }));

      // If no segments but we have text, create a single segment
      if (segments.length === 0 && response.text) {
        segments.push({
          id: "seg_0",
          text: response.text,
          startTimeSec: 0,
          endTimeSec: 0,
          speakerId: "speaker_1",
        });
      }

      console.log(`[OpenAITranscriptionProvider] Created ${segments.length} segments`);

      const uniqueSpeakerIds = Array.from(
        new Set(segments.map((s) => s.speakerId))
      );

      const speakers: Speaker[] = uniqueSpeakerIds.map((id, index) => ({
        id,
        displayName: `Speaker ${index + 1}`,
      }));

      const transcript: Transcript = {
        id: randomUUID(),
        audioSourceId,
        audioSourceProvider: audioSourceProvide,
        language: response.language || options?.language || "en",
        speakers,
        segments,
        createdAt: new Date(),
      };

      console.log(`[OpenAITranscriptionProvider] Transcription completed successfully`);
      return transcript;
    } catch (error: any) {
      console.error(`[OpenAITranscriptionProvider] Transcription failed:`, error);
      console.error(`[OpenAITranscriptionProvider] Error details:`, {
        message: error.message,
        status: error.status,
        code: error.code,
      });
      throw error;
    }
  }
}