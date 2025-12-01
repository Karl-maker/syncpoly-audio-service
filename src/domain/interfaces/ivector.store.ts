export interface VectorRecord {
    id: string;
    embedding: number[];
    metadata: Record<string, any>;
}
  
export interface VectorSearchResult {
    id: string;
    score: number;
    metadata: Record<string, any>;
}
  
export interface IVectorStore {
    upsertMany(records: VectorRecord[]): Promise<void>;
    search(
      queryEmbedding: number[],
      topK: number,
      filter?: Record<string, any>
    ): Promise<VectorSearchResult[]>;
}
  