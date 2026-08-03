import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SchoolAstroService, type AstroInput } from './school-astro.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';

/**
 * AI Astro Profile (Demo).
 *
 * Authenticated but not role-restricted: the report is generated purely from the
 * details typed into the form and reads no student, class or institute data, so
 * there is nothing here that one role should see and another should not.
 *
 * No AI-bridge call and no quota check — generation is local and deterministic,
 * so this endpoint costs nothing and cannot be rate-limited by a provider.
 */
@Controller('school/astro')
export class SchoolAstroController {
  constructor(private readonly svc: SchoolAstroService) {}

  @Post('generate')
  @UseGuards(SchoolJwtGuard)
  generate(@Body() body: AstroInput) {
    return { success: true, data: this.svc.generate(body) };
  }
}
