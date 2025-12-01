import OpenAI from "openai";
import { EmbeddingResult, IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embedTexts(
    texts: { id: string; text: string; metadata?: Record<string, any> }[]
  ): Promise<EmbeddingResult[]> {
    const input = texts.map((t) => t.text);

    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input,
    });

    return response.data.map((item, idx) => ({
      id: texts[idx].id,
      embedding: item.embedding,
      metadata: {
        ...(texts[idx].metadata || {}),
        text: texts[idx].text,
      },
    }));
  }
}
