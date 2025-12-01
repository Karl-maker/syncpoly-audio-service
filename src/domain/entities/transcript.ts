import { AudioSourceProvidersType } from "../enums/audio.source.provider";

export type SpeakerId = string; // e.g. "speaker_1", "speaker_2"

export interface Speaker {
  id: SpeakerId;         
  displayName: string;    
}

export interface TranscriptSegment {
  id: string;
  speakerId: SpeakerId;
  text: string;
  startTimeSec: number;
  endTimeSec: number;
}

export interface Transcript {
  id: string;
  audioSourceProvider: AudioSourceProvidersType;
  audioSourceId: string;  // where audio came from (e.g. GCS URI, upload ID)
  language: string;
  speakers: Speaker[];
  segments: TranscriptSegment[];
  createdAt: Date;
}