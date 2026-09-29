import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';

import { Public } from '../../common/decorators/auth.decorator';
import { BlogAdminGuard } from '../blog-admin-auth/blog-admin.guard';
import { CurrentBlogAdmin } from '../blog-admin-auth/current-blog-admin.decorator';
import { S3Service } from '../upload/s3.service';
import { BlogService } from './blog.service';
import { CreateBlogPostDto, ListBlogPostsQueryDto, PublicBlogQueryDto, UpdateBlogPostDto } from './dto/blog.dto';

/**
 * `GET blog` / `GET blog/:slug` are public — they power the marketing site's
 * /blog pages. Everything under `blog-admin/*` is guarded by BlogAdminGuard,
 * the blog panel's own login — not the LMS's JwtAuthGuard/RolesGuard, and not
 * reachable with an LMS super-admin token. See modules/blog-admin-auth.
 */
@ApiTags('Blog')
@Controller()
export class BlogController {
  constructor(
    private readonly blog: BlogService,
    private readonly s3Service: S3Service,
  ) {}

  // ── Public ───────────────────────────────────────────────────────────────

  @Get('blog')
  @Public()
  @ApiOperation({ summary: 'List published blog posts (public marketing site)' })
  async listPublic(@Query() query: PublicBlogQueryDto) {
    return this.blog.listPublic(query);
  }

  @Get('blog/:slug')
  @Public()
  @ApiOperation({ summary: 'Get one published blog post by slug (public marketing site)' })
  async getPublic(@Param('slug') slug: string) {
    return this.blog.findPublicBySlug(slug);
  }

  // ── Blog admin panel: manage posts ──────────────────────────────────────

  @Get('blog-admin/posts')
  @UseGuards(BlogAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all blog posts, any status (blog admin panel)' })
  async list(@Query() query: ListBlogPostsQueryDto) {
    return this.blog.list(query);
  }

  @Get('blog-admin/posts/:id')
  @UseGuards(BlogAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one blog post by id (blog admin panel)' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.findById(id);
  }

  @Post('blog-admin/posts')
  @UseGuards(BlogAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a blog post (blog admin panel)' })
  async create(@Body() dto: CreateBlogPostDto, @CurrentBlogAdmin('username') createdBy: string) {
    return this.blog.create(dto, createdBy);
  }

  @Patch('blog-admin/posts/:id')
  @UseGuards(BlogAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a blog post (blog admin panel)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blog.update(id, dto);
  }

  @Delete('blog-admin/posts/:id')
  @UseGuards(BlogAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a blog post (blog admin panel)' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.remove(id);
  }

  @Post('blog-admin/posts/upload-cover')
  @UseGuards(BlogAdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload a blog post cover image (blog admin panel)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.mimetype)) {
          return cb(new BadRequestException('Only JPEG, PNG, and WEBP files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadCover(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || `cover${ext}`;
    const key = `platform/blog/${Date.now()}-${uuidv4()}-${safeName}`;
    try {
      const url = await this.s3Service.upload(key, file.buffer, file.mimetype || 'image/jpeg');
      return { url, key };
    } catch (err: any) {
      throw new HttpException(err?.message || 'Upload failed', HttpStatus.BAD_REQUEST);
    }
  }
}
