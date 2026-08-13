import { Module } from '@nestjs/common';
import { SchoolRolesController } from './school-roles.controller';
import { SchoolRolesService } from './school-roles.service';

@Module({
  controllers: [SchoolRolesController],
  providers: [SchoolRolesService],
  exports: [SchoolRolesService],
})
export class SchoolRolesModule {}
