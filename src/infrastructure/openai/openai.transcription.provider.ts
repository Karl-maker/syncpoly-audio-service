import OpenAI from "openai";
import { randomUUID } from "crypto";
import * as streamToBuffer from "stream-to-array";
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
    const buffers = await streamToBuffer(audio as any);
    const audioBuffer = Buffer.concat(buffers as Buffer[]);

    // NOTE: API details may differ; treat this as pseudocode
    const file = new File([audioBuffer], "audio.wav", { type: "audio/wav" } as any);

    const response: any = await this.client.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe", // or "whisper-1"
      file,
      // Suppose diarization is supported and returns "segments" w/ speakers:
      // This is conceptual; adapt to real response shape.
      // diarization: options?.diarizeSpeakers ?? true,
    });

    // Example "response.segments" shape – adjust to actual API:
    const segments: TranscriptSegment[] = response.segments.map((seg: any, index: number) => ({
      id: seg.id ?? `seg_${index}`,
      text: seg.text,
      startTimeSec: seg.start,
      endTimeSec: seg.end,
      speakerId: seg.speaker || "speaker_1",
    }));

    const uniqueSpeakerIds = Array.from(
      new Set(segments.map((s) => s.speakerId))
    );

    const speakers: Speaker[] = uniqueSpeakerIds.map((id, index) => ({
      id,
      displayName: `Speaker ${index + 1}`, // user can rename later
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

    return transcript;
  }
}