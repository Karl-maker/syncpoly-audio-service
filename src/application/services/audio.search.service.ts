import { IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";
import { IVectorStore } from "../../domain/interfaces/ivector.store";

export interface SearchHit {
    text: string;
    score: number;
    startTimeSec: number;
    endTimeSec: number;
    transcriptId: string;
    segmentIds: string[];
  }
  
  export class AudioSearchService {
    constructor(
      private embeddingProvider: IEmbeddingProvider,
      private vectorStore: IVectorStore
    ) {}
  
    async search(query: string, topK: number = 5): Promise<SearchHit[]> {
      const [embedded] = await this.embeddingProvider.embedTexts([
        { id: "query", text: query },
      ]);
  
      const results = await this.vectorStore.search(embedded.embedding, topK);
  
      return results.map((r) => ({
        text: r.metadata.text ?? "",
        score: r.score,
        startTimeSec: r.metadata.startTimeSec,
        endTimeSec: r.metadata.endTimeSec,
        transcriptId: r.metadata.transcriptId,
        segmentIds: r.metadata.segmentIds || [],
      }));
    }
}