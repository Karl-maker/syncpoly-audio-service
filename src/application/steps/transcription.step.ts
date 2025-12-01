import { ITranscriptionProvider } from "../../domain/interfaces/itranscription.provider";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { IAudioProcessingStep } from "../pipeline/audio.processing.step";
import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { Transcript, TranscriptSegment } from "../../domain/entities/transcript";

// Split transcripts every 30 minutes (1800 seconds)
const TRANSCRIPT_CHUNK_DURATION_SEC = 30 * 60; // 30 minutes

export class TranscriptionStep implements IAudioProcessingStep {
    constructor(
      private transcriptionProvider: ITranscriptionProvider,
      private transcriptRepository?: TranscriptRepository
    ) {}
  
    async execute(context: AudioProcessingContext): Promise<AudioProcessingContext> {
      if (context.transcript) {
        // Already transcribed, skip
        console.log(`[TranscriptionStep] Transcript already exists, skipping`);
        return context;
      }
  
      console.log(`[TranscriptionStep] Starting transcription for audio source: ${context.audioSource.getId()}`);
      const stream = context.audioSource.getReadableStream();
      
      // Get filename and mimeType from options if available
      const filename = context.options?.filename || "audio.wav";
      const mimeType = context.options?.mimeType || "audio/wav";
      
      const fullTranscript = await this.transcriptionProvider.transcribeAudio(
        stream,
        context.audioSource.getId(),
        context.audioSourceProvider,
        { 
          diarizeSpeakers: true,
          filename,
          mimeType,
        }
      );
  
      console.log(`[TranscriptionStep] Transcription completed. Transcript ID: ${fullTranscript.id}, Segments: ${fullTranscript.segments.length}`);
      
      // Split transcript into chunks if it's longer than the chunk duration
      const transcriptChunks = this.splitTranscriptIntoChunks(fullTranscript, TRANSCRIPT_CHUNK_DURATION_SEC);
      console.log(`[TranscriptionStep] Split transcript into ${transcriptChunks.length} chunk(s)`);
      
      // Store all transcript chunks in MongoDB if repository is available
      let savedTranscripts: Transcript[] = [];
      if (this.transcriptRepository && transcriptChunks.length > 0) {
        try {
          const audioFileId = context.options?.audioFileId;
          
          for (let i = 0; i < transcriptChunks.length; i++) {
            const chunk = transcriptChunks[i];
            const savedTranscript = await this.transcriptRepository.create({
              audioFileId, // Link to audio file
              audioSourceId: chunk.audioSourceId,
              audioSourceProvider: chunk.audioSourceProvider,
              language: chunk.language,
              speakers: chunk.speakers,
              segments: chunk.segments,
              orderIndex: i, // Set order index for sorting
            } as Omit<Transcript, "id" | "createdAt">);
            savedTranscripts.push(savedTranscript);
            console.log(`[TranscriptionStep] Saved transcript chunk ${i} to MongoDB with ID: ${savedTranscript.id}`);
          }
          
          // Use the first chunk as the main transcript for the context (for backward compatibility)
          return { ...context, transcript: savedTranscripts[0] };
        } catch (error: any) {
          console.error(`[TranscriptionStep] Failed to save transcript chunks to MongoDB:`, error);
          // Continue with original transcript if save fails
        }
      } else {
        console.log(`[TranscriptionStep] No transcript repository provided, skipping MongoDB storage`);
      }
      
      // If no chunks were saved, use the original transcript
      return { ...context, transcript: transcriptChunks[0] || fullTranscript };
    }

    /**
     * Split a transcript into chunks based on duration
     * Each chunk contains segments that fit within the chunk duration
     */
    private splitTranscriptIntoChunks(
      transcript: Transcript,
      chunkDurationSec: number
    ): Transcript[] {
      if (transcript.segments.length === 0) {
        return [transcript];
      }

      // Calculate total duration
      const lastSegment = transcript.segments[transcript.segments.length - 1];
      const totalDuration = lastSegment.endTimeSec;

      // If transcript is shorter than chunk duration, return as single chunk
      if (totalDuration <= chunkDurationSec) {
        return [{ ...transcript, orderIndex: 0 }];
      }

      const chunks: Transcript[] = [];
      let currentChunkSegments: TranscriptSegment[] = [];
      let currentChunkStartTime = 0;
      let currentChunkIndex = 0;
      let currentChunkEndTime = 0;

      for (const segment of transcript.segments) {
        // If adding this segment would exceed chunk duration, start a new chunk
        if (
          currentChunkSegments.length > 0 &&
          segment.endTimeSec - currentChunkStartTime > chunkDurationSec
        ) {
          // Save current chunk
          chunks.push({
            ...transcript,
            id: `${transcript.id}-chunk-${currentChunkIndex}`,
            segments: currentChunkSegments,
            orderIndex: currentChunkIndex,
          });

          // Start new chunk
          currentChunkIndex++;
          currentChunkStartTime = segment.startTimeSec;
          currentChunkSegments = [segment];
          currentChunkEndTime = segment.endTimeSec;
        } else {
          // Add segment to current chunk
          if (currentChunkSegments.length === 0) {
            currentChunkStartTime = segment.startTimeSec;
          }
          currentChunkSegments.push(segment);
          currentChunkEndTime = segment.endTimeSec;
        }
      }

      // Add the last chunk
      if (currentChunkSegments.length > 0) {
        chunks.push({
          ...transcript,
          id: `${transcript.id}-chunk-${currentChunkIndex}`,
          segments: currentChunkSegments,
          orderIndex: currentChunkIndex,
        });
      }

      return chunks;
    }
}