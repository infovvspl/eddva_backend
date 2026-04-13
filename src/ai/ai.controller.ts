import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { AIService, DoubtRequest, DPPRequest, NotesRequest, CurriculumRequest } from './ai.service';
import { LLMService } from './llm.service';
import { RagService } from './rag.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/auth.decorator';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AIController {
  private readonly logger = new Logger(AIController.name);

  constructor(
    private readonly aiService: AIService,
    private readonly llm: LLMService,
    private readonly rag: RagService,
  ) {}

  // ── GET /ai/health — no auth required ────────────────────────────────────

  @Get('health')
  @Public()
  async health() {
    const [llmHealth, ragHealthy] = await Promise.all([
      this.llm.healthCheck(),
      this.rag.isHealthy(),
    ]);

    return {
      llm: llmHealth,
      rag: {
        status: ragHealthy ? 'ok' : 'unavailable',
        url: process.env.RAG_URL ?? 'http://localhost:8001',
      },
    };
  }

  // ── POST /ai/doubt — student submits doubt ────────────────────────────────

  @Post('doubt')
  @HttpCode(HttpStatus.OK)
  async solveDoubt(@Body() body: DoubtRequest) {
    if (!body?.question?.trim()) {
      throw new BadRequestException('question is required');
    }

    try {
      return await this.aiService.solveDoubt(body);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`solveDoubt error: ${err}`);
      throw new ServiceUnavailableException('AI service unavailable — try again later');
    }
  }

  // ── POST /ai/dpp — teacher generates DPP ─────────────────────────────────

  @Post('dpp')
  @HttpCode(HttpStatus.OK)
  async generateDPP(@Body() body: DPPRequest) {
    if (!body?.topic?.trim()) {
      throw new BadRequestException('topic is required');
    }
    if (!body?.subject?.trim()) {
      throw new BadRequestException('subject is required');
    }

    try {
      return await this.aiService.generateDPP(body);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`generateDPP error: ${err}`);
      throw new ServiceUnavailableException('AI service unavailable — try again later');
    }
  }

  // ── POST /ai/notes — teacher generates notes ──────────────────────────────

  @Post('notes')
  @HttpCode(HttpStatus.OK)
  async generateNotes(@Body() body: NotesRequest) {
    if (!body?.topic?.trim()) {
      throw new BadRequestException('topic is required');
    }
    if (!body?.subject?.trim()) {
      throw new BadRequestException('subject is required');
    }

    try {
      return await this.aiService.generateNotes(body);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`generateNotes error: ${err}`);
      throw new ServiceUnavailableException('AI service unavailable — try again later');
    }
  }

  // ── POST /ai/curriculum — teacher generates curriculum ────────────────────

  @Post('curriculum')
  @HttpCode(HttpStatus.OK)
  async generateCurriculum(@Body() body: CurriculumRequest) {
    if (!body?.subject?.trim()) {
      throw new BadRequestException('subject is required');
    }
    if (!body?.exam?.trim()) {
      throw new BadRequestException('exam is required');
    }

    try {
      return await this.aiService.generateCurriculum(body);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`generateCurriculum error: ${err}`);
      throw new ServiceUnavailableException('AI service unavailable — try again later');
    }
  }
}
