import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

/**
 * PPT generation is delegated entirely to the Django AI service (POST /ppt/*).
 * This service is a thin façade: it validates inputs, forwards to AiBridge,
 * and keeps the image-proxy helper (which must stay in NestJS because browsers
 * cannot send an Authorization header on bare <img src> requests).
 */
@Injectable()
export class SchoolPptService {
  private readonly logger = new Logger(SchoolPptService.name);

  constructor(private readonly aiBridge: AiBridgeService) {}

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
}
