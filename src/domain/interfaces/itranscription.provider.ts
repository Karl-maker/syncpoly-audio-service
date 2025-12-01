import { Transcript } from "../entities/transcript";
import { AudioSourceProvidersType } from "../enums/audio.source.provider";

export interface TranscriptionOptions {
  language?: string;
  diarizeSpeakers?: boolean;
  filename?: string;
  mimeType?: string;
}
  
export interface ITranscriptionProvider {
    transcribeAudio(
      audio: NodeJS.ReadableStream,
      audioSourceId: string,
      audioSourceProvider: AudioSourceProvidersType,
      options?: TranscriptionOptions
    ): Promise<Transcript>;
}