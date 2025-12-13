import { IVectorStore, VectorRecord } from "../../domain/interfaces/ivector.store";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { IAudioProcessingStep } from "../pipeline/audio.processing.step";

export class StoreInVectorDbStep implements IAudioProcessingStep {
    constructor(private vectorStore: IVectorStore) {}
  
  async execute(context: AudioProcessingContext): Promise<AudioProcessingContext> {
    if (!context.embeddings) {
      console.log("[StoreInVectorDbStep] No embeddings to store");
      return context;
    }

    // Determine the original file's S3 key for audioSourceId
    // Priority: originalFileS3Key (from options) > audioSource.getId() (current part key)
    // This ensures vectors are searchable by the original file key, not part keys
    const originalFileS3Key = context.options?.originalFileS3Key;
    const audioSourceId = originalFileS3Key 
      ? originalFileS3Key 
      : context.audioSource.getId();

    // Ensure userId and audioFileId are in metadata for proper organization
    const records: VectorRecord[] = context.embeddings.map((e) => ({
      id: e.id,
      embedding: e.embedding,
      metadata: {
        ...e.metadata,
        audioSourceId: audioSourceId,
        // Ensure userId and audioFileId are present (from chunk step or context options)
        userId: e.metadata.userId || context.options?.userId,
        audioFileId: e.metadata.audioFileId || context.options?.audioFileId,
      },
    }));

    console.log(`[StoreInVectorDbStep] Storing ${records.length} records`);
    console.log(`[StoreInVectorDbStep] Sample metadata:`, records[0]?.metadata);
    await this.vectorStore.upsertMany(records);
    console.log(`[StoreInVectorDbStep] Successfully stored ${records.length} records`);
    return context;
  }
}