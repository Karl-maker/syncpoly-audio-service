import { AudioProcessingContext } from "./audio.processing.context";
import { IAudioProcessingStep } from "./audio.processing.step";

export class AudioProcessingPipeline {
    private steps: IAudioProcessingStep[];
  
    constructor(steps: IAudioProcessingStep[]) {
      this.steps = steps;
    }
  
    async run(initialContext: AudioProcessingContext): Promise<AudioProcessingContext> {
      let ctx = initialContext;
      for (const step of this.steps) {
        ctx = await step.execute(ctx);
      }
      return ctx;
    }
}
  