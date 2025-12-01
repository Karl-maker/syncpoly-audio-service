import { Transcript } from "../../domain/entities/transcript";

export interface TranscriptResponse {
  id: string;
  audioFileId?: string;
  audioSourceId: string;
  audioSourceProvider: string;
  language: string;
  speakers: Array<{
    id: string;
    displayName: string;
  }>;
  segments: Array<{
    id: string;
    speakerId: string;
    text: string;
    startTimeSec: number;
    endTimeSec: number;
  }>;
  orderIndex?: number;
  createdAt: Date;
}

export function toTranscriptResponse(transcript: Transcript): TranscriptResponse {
  return {
    id: transcript.id,
    audioFileId: transcript.audioFileId,
    audioSourceId: transcript.audioSourceId,
    audioSourceProvider: transcript.audioSourceProvider,
    language: transcript.language,
    speakers: transcript.speakers.map((s) => ({
      id: s.id,
      displayName: s.displayName,
    })),
    segments: transcript.segments.map((s) => ({
      id: s.id,
      speakerId: s.speakerId,
      text: s.text,
      startTimeSec: s.startTimeSec,
      endTimeSec: s.endTimeSec,
    })),
    orderIndex: transcript.orderIndex,
    createdAt: transcript.createdAt,
  };
}

