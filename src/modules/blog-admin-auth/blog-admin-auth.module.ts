import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlogAdmin } from '../../database/entities/blog-admin.entity';
import { BlogAdminAuthController } from './blog-admin-auth.controller';
import { BlogAdminAuthService } from './blog-admin-auth.service';
import { BlogAdminGuard } from './blog-admin.guard';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BlogAdmin], 'coaching'),
    // No default secret registered here — every sign/verify call passes its
    // own `secret` explicitly (BlogAdminAuthService.secret), so this JWT
    // context can never be mixed up with the LMS's JwtModule registration.
    JwtModule.register({}),
  ],
  controllers: [BlogAdminAuthController],
  providers: [BlogAdminAuthService, BlogAdminGuard],
  exports: [BlogAdminAuthService, BlogAdminGuard],
})
export class BlogAdminAuthModule {}
