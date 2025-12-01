import { IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { IAudioProcessingStep } from "../pipeline/audio.processing.step";

export class ChunkAndEmbedStep implements IAudioProcessingStep {
    constructor(
      private embeddingProvider: IEmbeddingProvider,
      private maxCharsPerChunk: number = 500
    ) {}
  
    async execute(context: AudioProcessingContext): Promise<AudioProcessingContext> {
      if (!context.transcript) {
        console.log(`[ChunkAndEmbedStep] No transcript available, skipping`);
        return context; // nothing to embed
      }
  
      console.log(`[ChunkAndEmbedStep] Starting chunking and embedding. Transcript has ${context.transcript.segments.length} segments`);
      const segments = context.transcript.segments;
  
      // Simple chunking: group segment texts into chunks of ~maxCharsPerChunk
      const chunks: { id: string; text: string; metadata: any }[] = [];
      let currentText = "";
      let currentChunkIds: string[] = [];
      let currentStartTime = 0;
      let currentEndTime = 0;
  
      // Get audioFileId from context options if available
      const audioFileId = context.options?.audioFileId;
      const userId = context.options?.userId;

      for (const seg of segments) {
        const segText = seg.text.trim();
        if (!segText) continue;

        if (
          (currentText + " " + segText).length > this.maxCharsPerChunk &&
          currentText.length > 0
        ) {
          // Create chunk ID: audioFileId-segmentId1,segmentId2,...
          const segmentIdsStr = currentChunkIds.join(",");
          const chunkId = audioFileId 
            ? `${audioFileId}-${segmentIdsStr}`
            : segmentIdsStr;
          
          chunks.push({
            id: chunkId,
            text: currentText,
            metadata: {
              segmentIds: currentChunkIds,
              startTimeSec: currentStartTime,
              endTimeSec: currentEndTime,
              transcriptId: context.transcript.id,
              audioFileId: audioFileId,
              userId: userId,
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
        const segmentIdsStr = currentChunkIds.join(",");
        const chunkId = audioFileId 
          ? `${audioFileId}-${segmentIdsStr}`
          : segmentIdsStr;
        
        chunks.push({
          id: chunkId,
          text: currentText,
          metadata: {
            segmentIds: currentChunkIds,
            startTimeSec: currentStartTime,
            endTimeSec: currentEndTime,
            transcriptId: context.transcript!.id,
            audioFileId: audioFileId,
            userId: userId,
          },
        });
      }
  
      console.log(`[ChunkAndEmbedStep] Created ${chunks.length} chunks, generating embeddings...`);
      const embeddings = await this.embeddingProvider.embedTexts(chunks);
      console.log(`[ChunkAndEmbedStep] Generated ${embeddings.length} embeddings`);
  
      return { ...context, embeddings };
    }
}