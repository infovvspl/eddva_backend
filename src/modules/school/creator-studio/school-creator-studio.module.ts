import { Module } from '@nestjs/common';
import { SchoolCreatorStudioService } from './school-creator-studio.service';
import { SchoolCreatorStudioController } from './school-creator-studio.controller';

@Module({ controllers: [SchoolCreatorStudioController], providers: [SchoolCreatorStudioService] })
export class SchoolCreatorStudioModule {}
