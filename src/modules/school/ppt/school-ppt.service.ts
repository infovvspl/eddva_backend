import { Injectable, Logger, BadRequestException } from '@nestjs/common';

/**
 * Native AI PPT generation — ported from the standalone ppt-generator Express app
 * so it runs inside EDVA (no separate server). Uses GROQ (Llama 3.3 70B) for slide
 * content and Serper.dev for images. Keys come from env (GROQ_API_KEY, SERPER_API_KEY).
 */
@Injectable()
export class SchoolPptService {
  private readonly logger = new Logger(SchoolPptService.name);

  private readonly GROQ_API_KEY = process.env.GROQ_API_KEY || '';
  private readonly SERPER_API_KEY = process.env.SERPER_API_KEY || process.env.SERPER_KEY || '';
  private readonly GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly SERPER_URL = 'https://google.serper.dev/images';

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  // ── Public: full presentation ────────────────────────────────────────────
  async generate(body: any) {
    const { topic, slideCount = 5, language = 'English' } = body || {};
    if (!topic) throw new BadRequestException('Topic is required.');
    if (!this.GROQ_API_KEY) throw new BadRequestException('GROQ_API_KEY is not configured on the server.');

    this.logger.log(`Generating PPT — topic="${topic}", slides=${slideCount}, lang=${language}`);
    const slidesJson = await this.generateSlideContent(topic, slideCount, language);
    const slidesWithImages = await this.attachImagesToSlides(slidesJson.slides);
    return { success: true, data: { title: slidesJson.title, slides: slidesWithImages } };
  }

  // ── Public: regenerate a single slide ────────────────────────────────────
  async regenerateSlide(body: any) {
    const { slideIndex, topic, currentSlide, totalSlides } = body || {};
    if (topic === undefined || slideIndex === undefined) {
      throw new BadRequestException('slideIndex and topic are required.');
    }
    const slideType = slideIndex === 0 ? 'title' : slideIndex === totalSlides - 1 ? 'summary' : 'content';

    const systemPrompt = `You are a senior curriculum writer. Regenerate slide ${slideIndex + 1} of ${totalSlides} for a presentation about "${topic}". Type: "${slideType}".

BULLET RULE — each bullet must be ONE complete sentence of 12–20 words with a specific fact. Not a fragment. Not a long paragraph.
  ✗ TOO SHORT: "Located in Pakistan"
  ✗ TOO LONG: "The Harappan civilisation was centred in the Indus River Valley and stretched across approximately 1.25 million square kilometres covering modern-day Pakistan, northwest India, and parts of Afghanistan."
  ✓ CORRECT: "The Harappan civilisation (3300–1300 BCE) spanned 1.25 million sq km across modern Pakistan and India."

${slideType === 'title' ? 'Title slide: engaging title (5–8 words) + subtitle (10–18 words previewing what students will learn). bullets must be [].' : ''}
${slideType === 'summary' ? 'Summary slide: 5 bullet points, each a complete sentence of 12–20 words summarising one key fact from the presentation.' : ''}
${slideType === 'content' ? 'Content slide: EXACTLY 5 bullet points, each a complete sentence of 12–20 words with a specific fact, number, name, or detail. No fragments. No essays.' : ''}

IMAGE RULE: imageSearchTerm must describe the exact visual content of THIS slide's sub-topic — not the general topic. Include a visual type hint (map, diagram, photograph, artifact, chart).

Return ONLY valid JSON:
{
  "slideNumber": ${slideIndex + 1},
  "type": "${slideType}",
  "title": "Slide Title",
  "subtitle": "",
  "bullets": ["Complete sentence with specific facts.", "Another complete sentence..."],
  "speakerNotes": "3-4 sentences of teaching tips and discussion questions for the teacher",
  "imageSearchTerm": "specific 4-7 word term matching THIS slide's exact sub-topic with visual type hint"
}`;

    const res = await fetch(this.GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Regenerate slide ${slideIndex + 1} about "${topic}". Current slide data: ${JSON.stringify(currentSlide)}` },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new BadRequestException(`GROQ API error ${res.status}: ${errBody}`);
    }
    const groqData: any = await res.json();
    const newSlide = JSON.parse(groqData.choices[0].message.content);
    const imageData = await this.fetchImageForSlide(newSlide.imageSearchTerm, newSlide.title);
    newSlide.imageUrl = imageData.imageUrl;
    newSlide.imageBase64 = imageData.imageBase64;
    return { success: true, data: newSlide };
  }

  // ── Public: search a single image ────────────────────────────────────────
  async searchImage(body: any) {
    const searchTerm = body?.searchTerm;
    if (!searchTerm) throw new BadRequestException('searchTerm is required.');
    const imageData = await this.fetchImageForSlide(searchTerm, searchTerm);
    return { success: true, ...imageData };
  }

  // ── Public: proxy an external image (bypass hotlink protection) ───────────
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

  // ════════════════════════════════════════════════════════════════════════
  //  GROQ — slide content
  // ════════════════════════════════════════════════════════════════════════
  private repairJson(str: string): string {
    str = str.trim().replace(/^﻿/, '');
    str = str.replace(/"([a-zA-Z_]+)=([\s\S]*?)(?=",\s*\n|"\s*\n\s*[}\]])/g, (_m, key, val) => {
      val = val.trim();
      if (val.startsWith('[')) val = val.replace(/'([^']*)'/g, '"$1"');
      return `"${key}": ${val}`;
    });
    str = str.replace(/\[([^[\]{}]*?)\]/g, (match) =>
      match.includes("'") ? match.replace(/'([^']*)'/g, '"$1"') : match,
    );
    str = str.replace(/,(\s*[}\]])/g, '$1');
    return str;
  }

  private async generateSlideContent(topic: string, slideCount: number, language: string): Promise<any> {
    const systemPrompt = `You are an expert educational presentation designer creating classroom PPT slides.

═══ JSON FORMAT RULES ═══
• All strings: DOUBLE QUOTES only — never single quotes.
• "bullets": proper JSON array — "bullets": ["...", "..."]
• Never write bullets=[...] — always use a colon.
• No trailing commas before } or ].

═══ BULLET POINT STANDARD (most important rule) ═══
Each bullet point must be ONE complete, informative sentence of 12–20 words.
It must state a clear fact, include a specific detail, and be understandable on its own.

  ✗ TOO SHORT (fragment — rejected): "Located in Pakistan" / "Hot climate"
  ✗ TOO LONG (essay — rejected): a 40-word run-on sentence.
  ✓ CORRECT LENGTH (12–20 words):
      "The Harappan civilisation (3300–1300 BCE) covered 1.25 million sq km across modern Pakistan and India."
      "Cities like Mohenjo-daro used a precise grid layout with wide roads and brick-lined drainage systems."

═══ SLIDE STRUCTURE ═══
Generate EXACTLY ${slideCount} slides about "${topic}" in ${language}.

Slide 1  → type "title"
  • title: short compelling title (5–8 words)
  • subtitle: one sentence (10–18 words) that previews what students will learn
  • bullets: []

Slides 2 – ${slideCount - 1}  → type "content"
  • title: clear 3–6 word heading for this specific sub-topic
  • bullets: EXACTLY 5 bullet points — each a complete sentence of 12–20 words with a specific fact
  • Each slide must cover a DIFFERENT sub-topic.

Slide ${slideCount}  → type "summary"
  • title: "Key Takeaways" or similar
  • bullets: 5 bullet points, each a complete sentence of 12–20 words summarising one key fact

═══ IMAGE SEARCH TERM RULES ═══
imageSearchTerm MUST match the exact sub-topic of THAT slide — never the general topic.
  1. Term must name the concept specific to THAT slide.
  2. 4–7 words long.
  3. Include a visual type word: map, diagram, photograph, excavation, artifact, chart, illustration.

ALL slides:
  • speakerNotes: 2–3 sentences — a teaching tip or discussion question for the teacher

═══ OUTPUT ═══
Return ONLY valid JSON — no markdown fences, no commentary:
{
  "title": "Presentation Title",
  "slides": [
    { "slideNumber": 1, "type": "title", "title": "Engaging Main Title", "subtitle": "One sentence previewing what students will learn.", "bullets": [], "speakerNotes": "Ask students what they already know.", "imageSearchTerm": "topic overview educational photograph" },
    { "slideNumber": 2, "type": "content", "title": "Sub-Topic Heading", "subtitle": "", "bullets": ["Complete sentence of 12–20 words with a specific fact.", "Another complete sentence of 12–20 words.", "A sentence explaining a cause, effect, or significance.", "A sentence with a number, date, name, or comparison.", "An interesting detail that deepens understanding."], "speakerNotes": "Ask students: which fact surprised you most?", "imageSearchTerm": "specific 4-7 word term with visual hint" }
  ]
}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(this.GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Write a ${slideCount}-slide educational presentation about: "${topic}". Each bullet must be one complete sentence of 12–20 words with a specific fact. Not fragments. Not essays.` },
          ],
          temperature: attempt === 1 ? 0.7 : 0.4,
          max_tokens: 8000,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 400) {
          try {
            const errData = JSON.parse(errBody);
            const raw = errData?.error?.failed_generation;
            if (raw) {
              this.logger.warn(`Attempt ${attempt}: GROQ JSON validation failed, repairing…`);
              return JSON.parse(this.repairJson(raw));
            }
          } catch { /* fall through */ }
        }
        if (attempt === 3) throw new BadRequestException(`GROQ API error ${response.status}: ${errBody}`);
        await this.sleep(1000);
        continue;
      }

      const data: any = await response.json();
      const content = data.choices[0].message.content;
      try {
        return JSON.parse(content);
      } catch {
        try {
          return JSON.parse(this.repairJson(content));
        } catch {
          if (attempt === 3) throw new BadRequestException('Failed to parse GROQ response as JSON after 3 attempts');
          await this.sleep(1000);
        }
      }
    }
    throw new BadRequestException('Failed to generate slide content');
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Serper.dev — images
  // ════════════════════════════════════════════════════════════════════════
  private enrichSearchTerm(term: string, slideTitle: string): string {
    if (!term || term.trim().split(/\s+/).length < 3) {
      const base = (slideTitle || term || '').trim();
      return base + ' educational diagram photograph';
    }
    const visualHints = ['map', 'diagram', 'photograph', 'photo', 'chart', 'illustration', 'artifact', 'image', 'picture', 'excavation', 'figure', 'drawing'];
    const lower = term.toLowerCase();
    return visualHints.some((h) => lower.includes(h)) ? term : term + ' photograph';
  }

  private async fetchImageForSlide(searchTerm: string, slideTitle: string): Promise<{ imageUrl: string | null; imageBase64: string | null }> {
    if (!this.SERPER_API_KEY) return { imageUrl: null, imageBase64: null };
    try {
      const enriched = this.enrichSearchTerm(searchTerm, slideTitle);
      const serperRes = await fetch(this.SERPER_URL, {
        method: 'POST',
        headers: { 'X-API-KEY': this.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: enriched, num: 5 }),
      });
      if (!serperRes.ok) return { imageUrl: null, imageBase64: null };
      const serperData: any = await serperRes.json();
      const images = serperData.images || [];
      if (!images.length) return { imageUrl: null, imageBase64: null };
      for (const candidate of images.slice(0, 5)) {
        const imageBase64 = await this.downloadImageAsBase64(candidate.imageUrl);
        if (imageBase64) return { imageUrl: candidate.imageUrl, imageBase64 };
      }
      return { imageUrl: images[0].imageUrl, imageBase64: null };
    } catch (err: any) {
      this.logger.warn(`Image fetch error for "${searchTerm}": ${err?.message}`);
      return { imageUrl: null, imageBase64: null };
    }
  }

  private async downloadImageAsBase64(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.google.com/',
          Accept: 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1024) return null;
      const mimeType = contentType.split(';')[0].trim();
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private async attachImagesToSlides(slides: any[]): Promise<any[]> {
    const results: any[] = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      try {
        const imageData = await this.fetchImageForSlide(slide.imageSearchTerm, slide.title);
        results.push({ ...slide, imageUrl: imageData.imageUrl, imageBase64: imageData.imageBase64 });
      } catch {
        results.push({ ...slide, imageUrl: null, imageBase64: null });
      }
      if (i < slides.length - 1) await this.sleep(1000);
    }
    return results;
  }
}
