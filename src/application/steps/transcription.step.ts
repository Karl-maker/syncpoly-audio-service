import { ITranscriptionProvider } from "../../domain/interfaces/itranscription.provider";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { IAudioProcessingStep } from "../pipeline/audio.processing.step";

export class TranscriptionStep implements IAudioProcessingStep {
    constructor(private transcriptionProvider: ITranscriptionProvider) {}
  
    async execute(context: AudioProcessingContext): Promise<AudioProcessingContext> {
      if (context.transcript) {
        // Already transcribed, skip
        return context;
      }
  
      const stream = context.audioSource.getReadableStream();
      const transcript = await this.transcriptionProvider.transcribeAudio(
        stream,
        context.audioSource.getId(),
        context.audioSourceProvider,
        { diarizeSpeakers: true }
      );
  
      return { ...context, transcript };
    }
}