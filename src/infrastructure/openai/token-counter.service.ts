import { encoding_for_model } from "tiktoken";

/**
 * Service for accurately counting tokens using OpenAI's tiktoken library
 */
export class TokenCounterService {
  /**
   * Count tokens for a given text using the specified model's encoding
   * @param text The text to count tokens for
   * @param model The OpenAI model name (default: gpt-4o-mini)
   * @returns The number of tokens
   */
  static countTokens(text: string, model: string = "gpt-4o-mini"): number {
    try {
      const encoding = encoding_for_model(model as any);
      const tokens = encoding.encode(text);
      encoding.free(); // Free the encoding to prevent memory leaks
      return tokens.length;
    } catch (error) {
      console.error(`[TokenCounter] Error counting tokens for model ${model}:`, error);
      // Fallback: estimate tokens (approximately 4 characters per token)
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Count tokens for chat messages
   * This accounts for the special formatting tokens used in chat completions
   * @param messages Array of chat messages
   * @param model The OpenAI model name (default: gpt-4o-mini)
   * @returns The number of tokens
   */
  static countChatTokens(
    messages: Array<{ role: string; content: string }>,
    model: string = "gpt-4o-mini"
  ): number {
    try {
      const encoding = encoding_for_model(model as any);
      
      // OpenAI chat format uses special tokens:
      // - Each message has role tokens and content tokens
      // - There are special tokens for message boundaries
      // Approximate: 4 tokens per message (for role, formatting, etc.) + content tokens
      
      let totalTokens = 0;
      
      for (const message of messages) {
        // Count role token (approximately 1 token)
        totalTokens += 1;
        
        // Count content tokens
        const contentTokens = encoding.encode(message.content);
        totalTokens += contentTokens.length;
        
        // Count message boundary tokens (approximately 2-3 tokens per message)
        totalTokens += 2;
      }
      
      // Add tokens for the final message boundary
      totalTokens += 2;
      
      encoding.free();
      return totalTokens;
    } catch (error) {
      console.error(`[TokenCounter] Error counting chat tokens for model ${model}:`, error);
      // Fallback: estimate tokens
      const totalText = messages.map(m => m.content).join(" ");
      return Math.ceil(totalText.length / 4) + messages.length * 4;
    }
  }

  /**
   * Count prompt tokens (input) for chat completion
   * @param messages Array of chat messages
   * @param model The OpenAI model name (default: gpt-4o-mini)
   * @returns The number of prompt tokens
   */
  static countPromptTokens(
    messages: Array<{ role: string; content: string }>,
    model: string = "gpt-4o-mini"
  ): number {
    return this.countChatTokens(messages, model);
  }

  /**
   * Count completion tokens (output) for a response
   * @param text The completion text
   * @param model The OpenAI model name (default: gpt-4o-mini)
   * @returns The number of completion tokens
   */
  static countCompletionTokens(text: string, model: string = "gpt-4o-mini"): number {
    return this.countTokens(text, model);
  }
}

