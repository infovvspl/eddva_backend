import { Module } from '@nestjs/common';
import { SchoolAuthService } from './school-auth.service';
import { SchoolAuthController } from './school-auth.controller';
import { SchoolAdminUsersController } from './school-admin-users.controller';

@Module({
  controllers: [SchoolAuthController, SchoolAdminUsersController],
  providers: [SchoolAuthService],
  exports: [SchoolAuthService],
})
export class SchoolAuthModule {}
