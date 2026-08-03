import { Module } from '@nestjs/common';
import { SchoolAstroController } from './school-astro.controller';
import { SchoolAstroService } from './school-astro.service';

/**
 * Self-contained by design: no database, no AI bridge, no upload service. The
 * report is derived from the submitted details alone, so this module has no
 * dependencies to break and nothing to roll back if the feature is withdrawn.
 */
@Module({
  controllers: [SchoolAstroController],
  providers: [SchoolAstroService],
})
export class SchoolAstroModule {}
