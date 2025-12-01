import { IVectorStore, VectorRecord } from "../../domain/interfaces/ivector.store";
import { AudioProcessingContext } from "../pipeline/audio.processing.context";
import { IAudioProcessingStep } from "../pipeline/audio.processing.step";

export class StoreInVectorDbStep implements IAudioProcessingStep {
    constructor(private vectorStore: IVectorStore) {}
  
    async execute(context: AudioProcessingContext): Promise<AudioProcessingContext> {
      if (!context.embeddings) return context;
  
      const records: VectorRecord[] = context.embeddings.map((e) => ({
        id: e.id,
        embedding: e.embedding,
        metadata: {
          ...e.metadata,
          audioSourceId: context.audioSource.getId(),
        },
      }));
  
      await this.vectorStore.upsertMany(records);
      return context;
    }
}