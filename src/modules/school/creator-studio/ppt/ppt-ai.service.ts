import { Injectable, Logger } from '@nestjs/common';
import { Groq } from 'groq-sdk';

@Injectable()
export class PptAiService {
  private readonly logger = new Logger(PptAiService.name);
  private groqClient: Groq;

  constructor() {
    const key = process.env.GROQ_API_KEY || '';
    this.groqClient = new Groq({ apiKey: key });
  }

  async generatePlan(topic: string) {
    this.logger.log(`Generating plan for topic: ${topic}`);
    const completion = await this.groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `Create a presentation outline for ${topic}. Return JSON.`
        }
      ],
      response_format: { type: 'json_object' }
    });
    return JSON.parse(completion.choices[0].message.content);
  }

  async generatePlanFromPdf(file: Express.Multer.File, body: any) {
    this.logger.log(`Generating plan from PDF`);
    
    // Defer to the legacy PDF pipeline which has been ported and uses pdf-parse
    // and standard chunking for Llama-3-70b-versatile token safety.
    const pdfServiceModule = require('./services/pdfPresentationService');
    this.logger.log(`Imported pdfPresentationService: ${Object.keys(pdfServiceModule)}`);
    const { buildFromPDF } = pdfServiceModule;
    
    try {
      this.logger.log(`Calling buildFromPDF...`);
      const plan = await buildFromPDF(file.buffer, {
        classLevel: body?.classLevel,
        subject: body?.subject,
        board: body?.board
      });
      this.logger.log(`buildFromPDF returned: ${JSON.stringify(Object.keys(plan || {}))}`);
      return plan;
    } catch (error: any) {
      this.logger.error(`Failed to generate plan from PDF: ${error.message}`, error.stack);
      
      if (error.status === 400 || error.response) {
        throw error;
      }
      
      const { InternalServerErrorException } = require('@nestjs/common');
      throw new InternalServerErrorException(`AI Generation Failed: ${error.message}`);
    }
  }
}
