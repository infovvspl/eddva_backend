import { Injectable, Logger } from '@nestjs/common';
import PptxGenJS from 'pptxgenjs';
import { createPPT } from './services/pptService';

@Injectable()
export class PptGeneratorService {
  private readonly logger = new Logger(PptGeneratorService.name);

  async generatePptx(plan: any) {
    this.logger.log(`Generating PPTX...`);
    // Pass slides array from the plan, no outputPath, pass plan as context
    const buffer = await createPPT(plan.slides, null, plan);
    return buffer as Buffer;
  }
}
