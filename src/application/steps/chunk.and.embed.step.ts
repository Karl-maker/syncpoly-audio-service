import { IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { IAudioProcessingStep } from "../pipeline/audio.processing.step";

export class ChunkAndEmbedStep implements IAudioProcessingStep {
    constructor(
      private embeddingProvider: IEmbeddingProvider,
      private maxCharsPerChunk: number = 500
    ) {}
  
    async execute(context: AudioProcessingContext): Promise<AudioProcessingContext> {
      if (!context.transcript) return context; // nothing to embed
  
      const segments = context.transcript.segments;
  
      // Simple chunking: group segment texts into chunks of ~maxCharsPerChunk
      const chunks: { id: string; text: string; metadata: any }[] = [];
      let currentText = "";
      let currentChunkIds: string[] = [];
      let currentStartTime = 0;
      let currentEndTime = 0;
  
      for (const seg of segments) {
        const segText = seg.text.trim();
        if (!segText) continue;
  
        if (
          (currentText + " " + segText).length > this.maxCharsPerChunk &&
          currentText.length > 0
        ) {
          const chunkId = currentChunkIds.join(",");
          chunks.push({
            id: chunkId,
            text: currentText,
            metadata: {
              segmentIds: currentChunkIds,
              startTimeSec: currentStartTime,
              endTimeSec: currentEndTime,
              transcriptId: context.transcript.id,
            },
          });
  
          currentText = "";
          currentChunkIds = [];
        }
  
        if (currentChunkIds.length === 0) {
          currentStartTime = seg.startTimeSec;
        }
  
        currentText = currentText
          ? currentText + " " + segText
          : segText;
        currentChunkIds.push(seg.id);
        currentEndTime = seg.endTimeSec;
      }
  
      // Push last chunk
      if (currentText.length > 0 && currentChunkIds.length > 0) {
        const chunkId = currentChunkIds.join(",");
        chunks.push({
          id: chunkId,
          text: currentText,
          metadata: {
            segmentIds: currentChunkIds,
            startTimeSec: currentStartTime,
            endTimeSec: currentEndTime,
            transcriptId: context.transcript!.id,
          },
        });
      }
  
      const embeddings = await this.embeddingProvider.embedTexts(chunks);
  
      return { ...context, embeddings };
    }
}