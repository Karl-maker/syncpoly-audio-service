import { AudioProcessingContext } from "./audio.processing.context";
import { IAudioProcessingStep } from "./audio.processing.step";

export class AudioProcessingPipeline {
    private steps: IAudioProcessingStep[];
  
    constructor(steps: IAudioProcessingStep[]) {
      this.steps = steps;
    }
  
    async run(initialContext: AudioProcessingContext): Promise<AudioProcessingContext> {
      let ctx = initialContext;
      console.log(`[AudioProcessingPipeline] Running ${this.steps.length} steps`);
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];
        console.log(`[AudioProcessingPipeline] Executing step ${i + 1}/${this.steps.length}: ${step.constructor.name}`);
        try {
          ctx = await step.execute(ctx);
          console.log(`[AudioProcessingPipeline] Step ${i + 1} completed successfully`);
        } catch (error: any) {
          console.error(`[AudioProcessingPipeline] Step ${i + 1} (${step.constructor.name}) failed:`, error);
          throw error;
        }
      }
      console.log(`[AudioProcessingPipeline] All steps completed`);
      return ctx;
    }
}
  