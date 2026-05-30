import { Module } from '@nestjs/common';
import { SchoolMaterialService } from './school-material.service';
import { SchoolMaterialController } from './school-material.controller';

@Module({ controllers: [SchoolMaterialController], providers: [SchoolMaterialService] })
export class SchoolMaterialModule {}
