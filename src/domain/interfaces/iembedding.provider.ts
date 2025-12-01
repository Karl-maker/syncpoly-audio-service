export interface EmbeddingResult {
    id: string;
    embedding: number[];
    metadata: Record<string, any>;
}
  
export interface IEmbeddingProvider {
    embedTexts(
      texts: { id: string; text: string; metadata?: Record<string, any> }[]
    ): Promise<EmbeddingResult[]>;
}