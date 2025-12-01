import { Transcript } from "../../domain/entities/transcript";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";
import { IAudioSource } from "../../domain/interfaces/iaudio.source";
import { EmbeddingResult } from "../../domain/interfaces/iembedding.provider";

export interface AudioProcessingContext {
    audioSource: IAudioSource;
    audioSourceProvider: AudioSourceProvidersType;
    transcript?: Transcript;
    embeddings?: EmbeddingResult[];
    // For custom flags (e.g. “skipStorage”, “skipEmbeddings”) we can store more here
    options?: Record<string, any>;
}