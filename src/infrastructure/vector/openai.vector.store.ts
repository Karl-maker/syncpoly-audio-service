import OpenAI from "openai";
import {
  IVectorStore,
  VectorRecord,
  VectorSearchResult,
} from "../../domain/interfaces/ivector.store";

/**
 * OpenAI Vector Store implementation using OpenAI's Vector Store API.
 * 
 * Note: OpenAI's Vector Store API works with files, so this implementation
 * stores embeddings and metadata as JSON files in the vector store.
 * 
 * This implementation uses OpenAI's Vector Store API (not beta).
 */
export class OpenAIVectorStore implements IVectorStore {
  private client: OpenAI;
  private vectorStoreId: string | null = null;
  private readonly vectorStoreName: string;
  private fileIdToRecordId: Map<string, string> = new Map();

  constructor(
    apiKey: string,
    vectorStoreName: string = "audio-service-vector-store"
  ) {
    this.client = new OpenAI({ apiKey });
    this.vectorStoreName = vectorStoreName;
  }

  /**
   * Initialize or get the vector store ID.
   * Creates a new vector store if one doesn't exist.
   */
  private async getOrCreateVectorStore(): Promise<string> {
    if (this.vectorStoreId) {
      return this.vectorStoreId;
    }

    try {
      // List existing vector stores to find one with matching name
      const vectorStores = await this.client.vectorStores.list();
      const existing = vectorStores.data.find(
        (vs: { name?: string | null }) => vs.name === this.vectorStoreName
      );

      if (existing) {
        this.vectorStoreId = existing.id;
        return existing.id;
      }
    } catch (error) {
      // If listing fails, try to create a new one
    }

    // Create new vector store
    const vectorStore = await this.client.vectorStores.create({
      name: this.vectorStoreName,
    });

    this.vectorStoreId = vectorStore.id;
    return vectorStore.id;
  }

  /**
   * Upsert many records into the vector store.
   * Creates temporary files with embedding data and uploads them.
   */
  async upsertMany(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    const vectorStoreId = await this.getOrCreateVectorStore();

    // Create files for each record
    const filePromises = records.map(async (record) => {
      // Create a JSON file with the embedding and metadata
      const fileContent = JSON.stringify({
        id: record.id,
        embedding: record.embedding,
        metadata: record.metadata,
      });

      // Convert to Buffer for Node.js
      // Buffer is available globally in Node.js
      const buffer = (globalThis as any).Buffer.from(fileContent, "utf-8");

      // Create a File-like object for OpenAI SDK
      // In Node.js 18+, File is available globally
      // Using type assertion to work with TypeScript
      const FileConstructor = (globalThis as any).File;
      const file = new FileConstructor([buffer], `${record.id}.json`, {
        type: "application/json",
      });

      // Upload file
      const uploadedFile = await this.client.files.create({
        file: file,
        purpose: "assistants",
      });

      // Track the mapping
      this.fileIdToRecordId.set(uploadedFile.id, record.id);

      return uploadedFile.id;
    });

    const fileIds = await Promise.all(filePromises);

    // Add files to vector store using file batches for efficiency
    // OpenAI supports adding multiple files at once via file batches
    await this.client.vectorStores.fileBatches.create(vectorStoreId, {
      file_ids: fileIds,
    });

    // Wait for files to be processed
    await this.waitForFileProcessing(fileIds);
  }

  /**
   * Search for similar vectors in the store.
   * Uses OpenAI's file search capabilities through the vector store.
   * 
   * Note: OpenAI's Vector Store search API uses text queries, not embeddings.
   * Since we're storing embeddings directly, we retrieve files and perform
   * local similarity search.
   */
  async search(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, any>
  ): Promise<VectorSearchResult[]> {
    const vectorStoreId = await this.getOrCreateVectorStore();

    // OpenAI's Vector Store API doesn't support direct embedding search.
    // We need to retrieve all files and do local similarity search.
    // Note: This approach works but may not scale well for very large datasets.
    
    const vectorStoreFiles = await this.client.vectorStores.files.list(
      vectorStoreId
    );

    // Download and parse all files
    const records: VectorRecord[] = [];
    for (const file of vectorStoreFiles.data) {
      try {
        const fileContent = await this.client.files.content(file.id);
        const text = await fileContent.text();
        const record = JSON.parse(text) as VectorRecord;
        
        // Apply filter if provided
        if (this.matchesFilter(record.metadata, filter)) {
          records.push(record);
        }
      } catch (error) {
        // Silently skip files that can't be processed
        // In production, you might want to log this
      }
    }

    // Calculate cosine similarity for each record
    const scored = records
      .map((record) => ({
        record,
        score: this.cosineSimilarity(queryEmbedding, record.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map((s) => ({
      id: s.record.id,
      score: s.score,
      metadata: s.record.metadata,
    }));
  }

  /**
   * Wait for files to be processed by OpenAI.
   */
  private async waitForFileProcessing(
    fileIds: string[],
    maxWaitTime: number = 60000
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second

    while (Date.now() - startTime < maxWaitTime) {
      const allProcessed = await Promise.all(
        fileIds.map(async (fileId) => {
          const file = await this.client.files.retrieve(fileId);
          return file.status === "processed";
        })
      );

      if (allProcessed.every((processed) => processed)) {
        return;
      }

      await new Promise<void>((resolve) =>
        (globalThis as any).setTimeout(() => resolve(), checkInterval)
      );
    }

    throw new Error("File processing timeout");
  }

  /**
   * Check if metadata matches the filter criteria.
   */
  private matchesFilter(
    metadata: Record<string, any>,
    filter?: Record<string, any>
  ): boolean {
    if (!filter) return true;
    return Object.entries(filter).every(([key, val]) => metadata[key] === val);
  }

  /**
   * Calculate cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));

    if (!normA || !normB) return 0;
    return dot / (normA * normB);
  }

  /**
   * Delete the vector store (useful for cleanup).
   */
  async deleteVectorStore(): Promise<void> {
    if (this.vectorStoreId) {
      await this.client.vectorStores.delete(this.vectorStoreId);
      this.vectorStoreId = null;
      this.fileIdToRecordId.clear();
    }
  }
}

