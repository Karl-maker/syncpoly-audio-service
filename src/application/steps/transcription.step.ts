import { ITranscriptionProvider } from "../../domain/interfaces/itranscription.provider";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { IAudioProcessingStep } from "../pipeline/audio.processing.step";
import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { Transcript } from "../../domain/entities/transcript";

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
      
      const transcript = await this.transcriptionProvider.transcribeAudio(
        stream,
        context.audioSource.getId(),
        context.audioSourceProvider,
        { 
          diarizeSpeakers: true,
          filename,
          mimeType,
        }
      );
  
      console.log(`[TranscriptionStep] Transcription completed. Transcript ID: ${transcript.id}, Segments: ${transcript.segments.length}`);
      
      // Store transcript in MongoDB if repository is available
      if (this.transcriptRepository) {
        try {
          // Create transcript without id, createdAt, and updatedAt (repository will add them)
          const savedTranscript = await this.transcriptRepository.create({
            audioSourceId: transcript.audioSourceId,
            audioSourceProvider: transcript.audioSourceProvider,
            language: transcript.language,
            speakers: transcript.speakers,
            segments: transcript.segments,
          } as Omit<Transcript, "id" | "createdAt" | "updatedAt">);
          console.log(`[TranscriptionStep] Transcript saved to MongoDB with ID: ${savedTranscript.id}`);
          // Update context with saved transcript (which has MongoDB-generated ID)
          return { ...context, transcript: savedTranscript };
        } catch (error: any) {
          console.error(`[TranscriptionStep] Failed to save transcript to MongoDB:`, error);
          // Continue with original transcript if save fails
        }
      } else {
        console.log(`[TranscriptionStep] No transcript repository provided, skipping MongoDB storage`);
      }
      
      return { ...context, transcript };
    }
}