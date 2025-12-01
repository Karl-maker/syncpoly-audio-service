import { AudioProcessingContext } from "./audio.processing.context";

export interface IAudioProcessingStep {
    execute(context: AudioProcessingContext): Promise<AudioProcessingContext>;
}