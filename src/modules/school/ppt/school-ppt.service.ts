import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
const AdmZip = require('adm-zip');

/**
 * PPT generation is delegated entirely to the Django AI service (POST /ppt/*).
 * This service is a thin façade: it validates inputs, forwards to AiBridge,
 * and keeps the image-proxy helper (which must stay in NestJS because browsers
 * cannot send an Authorization header on bare <img src> requests).
 */
@Injectable()
export class SchoolPptService {
  private readonly logger = new Logger(SchoolPptService.name);

  constructor(
    private readonly aiBridge: AiBridgeService,
    @InjectDataSource('school') private readonly ds: DataSource,
  ) {}

  async generate(body: any, instituteId?: string) {
    const { topic, slideCount = 5, language = 'English' } = body || {};
    if (!topic) throw new BadRequestException('Topic is required.');
    return this.aiBridge.generatePpt({ topic, slideCount, language }, instituteId);
  }

  async regenerateSlide(body: any, instituteId?: string) {
    const { slideIndex, topic, currentSlide, totalSlides } = body || {};
    if (topic === undefined || slideIndex === undefined) {
      throw new BadRequestException('slideIndex and topic are required.');
    }
    return this.aiBridge.regeneratePptSlide(
      { slideIndex, topic, currentSlide, totalSlides },
      instituteId,
    );
  }

  async searchImage(body: any, instituteId?: string) {
    const searchTerm = body?.searchTerm;
    if (!searchTerm) throw new BadRequestException('searchTerm is required.');
    return this.aiBridge.searchPptImage({ searchTerm }, instituteId);
  }

  /** Proxy an external image URL — bypasses hotlink protection for studio preview. */
  async proxyImage(url: string): Promise<{ contentType: string; buffer: Buffer } | null> {
    if (!url) return null;
    try {
      const imgRes = await fetch(decodeURIComponent(url), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.google.com/',
          Accept: 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!imgRes.ok) return null;
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      return { contentType, buffer };
    } catch (err: any) {
      this.logger.warn(`Proxy image failed: ${err?.message}`);
      return null;
    }
  }

  async getMaterialSlideImage(materialId: string, slideIndex: number): Promise<{ contentType: string; buffer: Buffer } | null> {
    try {
      // 1. Fetch the material S3 URL
      const rows = await this.ds.query(
        `SELECT s3_key FROM study_materials WHERE id = $1`,
        [materialId],
      );
      if (!rows.length || !rows[0].s3_key) return null;
      const fileUrl = rows[0].s3_key;

      // 2. Download pptx file buffer
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      const pptxBuffer = Buffer.from(await res.arrayBuffer());

      // 3. Unzip pptx file in memory
      const zip = new AdmZip(pptxBuffer);

      // Relationship file path for slideN (slideIndex starts at 0, slide files are 1-indexed)
      const relPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
      const relEntry = zip.getEntry(relPath);
      if (!relEntry) return null;

      const relXml = relEntry.getData().toString('utf8');

      // 4. Extract target relationship for image
      const match = relXml.match(/Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/image"[^>]*Target="([^"]+)"/);
      if (!match) return null;

      let target = match[1];

      // 5. If external URL, download and return
      if (target.startsWith('http://') || target.startsWith('https://')) {
        return this.proxyImage(target);
      }

      // 6. If local relative path inside the zip archive, extract it
      const normalizedPath = target.replace(/^\.\.\//, 'ppt/');
      const imgEntry = zip.getEntry(normalizedPath);
      if (!imgEntry) return null;

      const buffer = imgEntry.getData();
      const ext = normalizedPath.split('.').pop()?.toLowerCase() || 'png';
      const contentTypeMap = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
      };
      const contentType = contentTypeMap[ext] || 'image/png';

      return { contentType, buffer };
    } catch (err: any) {
      this.logger.warn(`Failed to extract slide image from material ${materialId}: ${err?.message}`);
      return null;
    }
  }
}
