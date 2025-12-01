import { IVectorStore, VectorRecord, VectorSearchResult } from "../../domain/interfaces/ivector.store";
  
  export class InMemoryVectorStore implements IVectorStore {
    private records: VectorRecord[] = [];
  
    async upsertMany(records: VectorRecord[]): Promise<void> {
      // super naive upsert
      const ids = new Set(records.map((r) => r.id));
      this.records = this.records.filter((r) => !ids.has(r.id));
      this.records.push(...records);
    }
  
    async search(
      queryEmbedding: number[],
      topK: number,
      filter?: Record<string, any>
    ): Promise<VectorSearchResult[]> {
      const scored = this.records
        .filter((r) => this.matchesFilter(r.metadata, filter))
        .map((r) => ({
          record: r,
          score: this.cosineSimilarity(queryEmbedding, r.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
  
      return scored.map((s) => ({
        id: s.record.id,
        score: s.score,
        metadata: s.record.metadata,
      }));
    }
  
    private matchesFilter(
      metadata: Record<string, any>,
      filter?: Record<string, any>
    ): boolean {
      if (!filter) return true;
      return Object.entries(filter).every(([key, val]) => metadata[key] === val);
    }
  
    private cosineSimilarity(a: number[], b: number[]): number {
      const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
      const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
      const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
      if (!normA || !normB) return 0;
      return dot / (normA * normB);
    }
  }
  