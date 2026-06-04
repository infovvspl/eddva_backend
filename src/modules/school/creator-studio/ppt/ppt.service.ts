import { Injectable } from '@nestjs/common';
import { PptAiService } from './ppt-ai.service';
import { PptGeneratorService } from './ppt-generator.service';
import { buildPresentation } from './services/presentationService';

@Injectable()
export class PptService {
  constructor(
    private readonly pptAiService: PptAiService,
    private readonly pptGeneratorService: PptGeneratorService
  ) {}

  async generate(body: any) {
    const context = {
      topic: body.topic,
      classLevel: body.classLevel,
      subject: body.subject,
      board: body.board
    };
    
    // 1. Build presentation JSON using AI and config
    const presentationData = await buildPresentation(context);
    
    // 2. Generate PPTX buffer
    const buffer = await this.pptGeneratorService.generatePptx(presentationData);
    
    return buffer;
  }

  async generateFromPdf(file: Express.Multer.File, body: any) {
    const plan = await this.pptAiService.generatePlanFromPdf(file, body);
    return this.pptGeneratorService.generatePptx(plan);
  }
}
