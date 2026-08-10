import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DocumentGeneratorService } from './src/modules/document-generator/document-generator.service';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const svc = app.get(DocumentGeneratorService);
  
  // Try to generate a PDF using dummy payload (just need to test puppeteer)
  try {
    const htmlContent = `<h1>Hello World</h1><p>Test PDF generation</p>`;
    const pdfBuffer = await svc['renderPdf'](htmlContent, { width: 54, height: 86 });
    fs.writeFileSync('test.pdf', pdfBuffer);
    console.log('PDF generated! Size:', pdfBuffer.length);
  } catch (err) {
    console.log('Failed:', err.message);
  }
  
  await app.close();
}
bootstrap();
