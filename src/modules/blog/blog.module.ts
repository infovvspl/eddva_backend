import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlogPost } from '../../database/entities/blog-post.entity';
import { UploadModule } from '../upload/upload.module';
import { BlogAdminAuthModule } from '../blog-admin-auth/blog-admin-auth.module';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BlogPost], 'coaching'),
    UploadModule,
    BlogAdminAuthModule,
  ],
  controllers: [BlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
