import { Controller, Post, Body, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { PptService } from './ppt.service';

@Controller('school/creator-studio/ppt')
export class PptController {
  constructor(private readonly pptService: PptService) {}

  @Post('generate')
  async generate(@Body() body: any, @Res() res: Response) {
    const buffer = await this.pptService.generate(body);
    const filename = `Presentation_${Date.now()}.pptx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Post('generate-from-pdf')
  @UseInterceptors(FileInterceptor('pdf'))
  async generateFromPdf(@UploadedFile() file: Express.Multer.File, @Body() body: any, @Res() res: Response) {
    const buffer = await this.pptService.generateFromPdf(file, body);
    const filename = `Presentation_PDF_${Date.now()}.pptx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
