import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpException,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { TenantId, Public } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { GenerateUploadUrlDto, UploadType } from './dto/upload.dto';
import { S3Service } from './s3.service';

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class UploadController {
  private static readonly MAX_STANDARD_FILE_SIZE = 10 * 1024 * 1024;
  private static readonly MAX_MATERIAL_FILE_SIZE = 100 * 1024 * 1024;
  private static readonly MAX_VIDEO_FILE_SIZE = 2 * 1024 * 1024 * 1024;

  constructor(
    private readonly s3Service: S3Service,
    private readonly config: ConfigService,
  ) {}

  @Post('upload/doubt-response-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload doubt response image via backend (avoids browser→S3 CORS)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: UploadController.MAX_STANDARD_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!file?.mimetype?.startsWith('image/')) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadDoubtResponseImage(
    @UploadedFile() file: Express.Multer.File,
    @TenantId() tenantId: string,
    @Body('replaceUrl') replaceUrl?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!tenantId) {
      throw new BadRequestException('Tenant ID could not be determined from the authenticated user');
    }
    
    let key: string;
    if (replaceUrl && typeof replaceUrl === 'string' && replaceUrl.startsWith('http')) {
      try {
        // Remove query params (like cache-busters) to get the clean S3 key
        const cleanUrl = replaceUrl.split('?')[0];
        const extractedKey = this.s3Service.keyFromUrl(cleanUrl);
        if (extractedKey.startsWith(`tenants/${tenantId}/`)) {
          key = extractedKey;
        } else {
          throw new BadRequestException('Cannot overwrite files belonging to another tenant');
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
      }
    }

    if (!key) {
      const ext = extname(file.originalname).toLowerCase() || '.jpg';
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || `doubt-image${ext}`;
      key = `tenants/${tenantId}/doubts/response-images/${Date.now()}-${uuidv4()}-${safeName}`;
    }

    try {
      const url = await this.s3Service.upload(key, file.buffer, file.mimetype || 'image/jpeg');
      return { url, key };
    } catch (err) {
      throw new HttpException(err?.message || 'Upload failed', HttpStatus.BAD_REQUEST);
    }
  }

  @Post('upload/platform-logo')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload platform logo' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!['image/svg+xml', 'image/png', 'image/webp'].includes(file?.mimetype)) {
          return cb(new BadRequestException('Only SVG, PNG, and WEBP files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadPlatformLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const ext = extname(file.originalname).toLowerCase() || '.png';
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || `logo${ext}`;
    const key = `platform/branding/${Date.now()}-${uuidv4()}-${safeName}`;
    try {
      const url = await this.s3Service.upload(key, file.buffer, file.mimetype || 'image/png');
      return { url, key };
    } catch (err: any) {
      throw new HttpException(err?.message || 'Upload failed', HttpStatus.BAD_REQUEST);
    }
  }

  @Post('upload-url')
  @ApiOperation({ summary: 'Generate a tenant-scoped pre-signed S3 PUT URL' })
  async getUploadUrl(
    @Body() dto: GenerateUploadUrlDto,
    @TenantId() tenantId: string,
    @Req() req: any,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID could not be determined from the authenticated user');
    }

    this.validateFileSize(dto.type, dto.fileSize);
    this.validateRequiredFields(dto);
    this.validateContentType(dto.type, dto.contentType);

    const key = this.buildKey(tenantId, dto);
    const presignResult = await this.s3Service.presign(key, dto.contentType);

    const host = this.config.get('app.url') || `${req.protocol}://${req.get('host')}`;
    const proxyUrl = `${host}/api/v1/upload/proxy?url=${encodeURIComponent(presignResult.uploadUrl)}&contentType=${encodeURIComponent(dto.contentType)}`;
    return {
      uploadUrl: proxyUrl,
      fileUrl: presignResult.fileUrl,
    };
  }

  @Put('upload/proxy')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Proxy PUT upload requests to S3 to bypass browser CORS' })
  async proxyUpload(
    @Query('url') s3Url: string,
    @Query('contentType') contentType: string,
    @Req() req: any,
  ) {
    const MAX_PROXY_BYTES = 100 * 1024 * 1024; // 100 MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_PROXY_BYTES) {
      throw new BadRequestException('File too large. Maximum upload size is 100 MB.');
    }
    if (!s3Url) {
      throw new BadRequestException('url query parameter is required');
    }

    // SECURITY: only allow presigned S3/R2 URLs — block SSRF to internal hosts
    let parsedUrl: URL;
    try { parsedUrl = new URL(s3Url); } catch {
      throw new BadRequestException('Invalid URL');
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    const allowedPatterns = [
      /\.amazonaws\.com$/,
      /\.r2\.cloudflarestorage\.com$/,
      /\.r2\.dev$/,
      /\.backblazeb2\.com$/,
    ];
    if (!allowedPatterns.some(p => p.test(hostname))) {
      throw new BadRequestException('Proxy target not allowed');
    }
    // Block private/loopback addresses just in case a valid-looking hostname resolves internally
    if (
      hostname === 'localhost' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === '169.254.169.254'
    ) {
      throw new BadRequestException('Proxy target not allowed');
    }

    try {
      await axios.put(s3Url, req, {
        headers: {
          'Content-Type': contentType || req.headers['content-type'] || 'application/octet-stream',
          'Content-Length': req.headers['content-length'],
        },
        maxContentLength: MAX_PROXY_BYTES,
        maxBodyLength: MAX_PROXY_BYTES,
      });

      return { success: true };
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data || err?.message || 'Proxy upload to S3 failed',
        err?.response?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete('upload/file')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  @ApiOperation({ summary: 'Delete a tenant-scoped S3 object by key' })
  async deleteFile(
    @Body('key') key: string,
    @TenantId() tenantId: string,
  ) {
    if (!key) {
      throw new BadRequestException('key is required');
    }

    if (!tenantId) {
      throw new BadRequestException('Tenant ID could not be determined from the authenticated user');
    }

    if (!key.startsWith(`tenants/${tenantId}/`)) {
      throw new BadRequestException('You can only delete files that belong to your tenant');
    }

    await this.s3Service.delete(key);
    return { deleted: true, key };
  }

  private validateFileSize(type: UploadType, fileSize: number) {
    const maxBytes = type === UploadType.LECTURE_VIDEO
      ? UploadController.MAX_VIDEO_FILE_SIZE
      : type === UploadType.MATERIAL
        ? UploadController.MAX_MATERIAL_FILE_SIZE
        : type === UploadType.CHAT_ATTACHMENT
          ? 20 * 1024 * 1024 // 20 MB
          : UploadController.MAX_STANDARD_FILE_SIZE;

    if (fileSize > maxBytes) {
      const limitLabel = type === UploadType.LECTURE_VIDEO
        ? '2 GB'
        : type === UploadType.MATERIAL
          ? '100 MB'
          : type === UploadType.CHAT_ATTACHMENT
            ? '20 MB'
            : '10 MB';
      throw new BadRequestException(`File size must be less than or equal to ${limitLabel}`);
    }
  }

  private validateRequiredFields(dto: GenerateUploadUrlDto) {
    const courseRequiredTypes = new Set<UploadType>([
      UploadType.THUMBNAIL,
      UploadType.MATERIAL,
      UploadType.SOURCE,
      UploadType.LECTURE_VIDEO,
      UploadType.LECTURE_THUMBNAIL,
      UploadType.LECTURE_ATTACHMENT,
    ]);

    const lectureRequiredTypes = new Set<UploadType>([
      UploadType.LECTURE_VIDEO,
      UploadType.LECTURE_THUMBNAIL,
      UploadType.LECTURE_ATTACHMENT,
    ]);

    if (courseRequiredTypes.has(dto.type) && !dto.courseId) {
      throw new BadRequestException('courseId is required for this upload type');
    }

    if (lectureRequiredTypes.has(dto.type) && !dto.lectureId) {
      throw new BadRequestException('lectureId is required for this upload type');
    }
  }

  private validateContentType(type: UploadType, contentType: string) {
    switch (type) {
      case UploadType.PROFILE:
      case UploadType.THUMBNAIL:
      case UploadType.LECTURE_THUMBNAIL:
        if (!contentType.startsWith('image/')) {
          throw new BadRequestException('Content type must be an image');
        }
        break;
      case UploadType.MATERIAL:
      case UploadType.LECTURE_ATTACHMENT:
        if (contentType !== 'application/pdf' && !contentType.startsWith('image/')) {
          throw new BadRequestException('Materials and lecture attachments must be PDF or image');
        }
        break;
      case UploadType.DOUBT_RESPONSE_IMAGE:
        if (!contentType.startsWith('image/')) {
          throw new BadRequestException('Doubt response images must use an image content type');
        }
        break;
      case UploadType.STUDY_MATERIAL:
        if (contentType !== 'application/pdf') {
          throw new BadRequestException('Study materials must be PDF files');
        }
        break;
      case UploadType.SOURCE:
        if (contentType !== 'application/zip' && contentType !== 'application/x-zip-compressed') {
          throw new BadRequestException('Source files must be ZIP archives');
        }
        break;
      case UploadType.LECTURE_VIDEO:
        if (!contentType.startsWith('video/')) {
          throw new BadRequestException('Lecture videos must use a video content type');
        }
        break;
      case UploadType.CHAT_ATTACHMENT:
        const allowedTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/zip',
          'application/x-zip-compressed',
          'text/plain',
          'text/csv',
          'text/html'
        ];
        if (
          !contentType.startsWith('image/') &&
          !contentType.startsWith('video/') &&
          !contentType.startsWith('audio/') &&
          !allowedTypes.includes(contentType)
        ) {
          throw new BadRequestException('Invalid content type for chat attachment');
        }
        break;
    }
  }

  private buildKey(tenantId: string, dto: GenerateUploadUrlDto): string {
    const safeOriginalName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeOriginalName) {
      throw new BadRequestException('fileName must contain at least one valid character');
    }

    const fileName = `${Date.now()}-${uuidv4()}-${safeOriginalName}`;

    switch (dto.type) {
      case UploadType.PROFILE:
        return `tenants/${tenantId}/admin/profile/${fileName}`;
      case UploadType.THUMBNAIL:
        return `tenants/${tenantId}/courses/${dto.courseId}/thumbnail/${fileName}`;
      case UploadType.MATERIAL:
        return `tenants/${tenantId}/courses/${dto.courseId}/materials/${fileName}`;
      case UploadType.SOURCE:
        return `tenants/${tenantId}/courses/${dto.courseId}/source/${fileName}`;
      case UploadType.LECTURE_VIDEO:
        return `tenants/${tenantId}/courses/${dto.courseId}/lectures/${dto.lectureId}/video/${fileName}`;
      case UploadType.LECTURE_THUMBNAIL:
        return `tenants/${tenantId}/courses/${dto.courseId}/lectures/${dto.lectureId}/thumbnail/${fileName}`;
      case UploadType.LECTURE_ATTACHMENT:
        return `tenants/${tenantId}/courses/${dto.courseId}/lectures/${dto.lectureId}/attachments/${fileName}`;
      case UploadType.DOUBT_RESPONSE_IMAGE:
        return `tenants/${tenantId}/doubts/response-images/${fileName}`;
      case UploadType.STUDY_MATERIAL:
        return `tenants/${tenantId}/study-materials/${fileName}`;
      case UploadType.CHAT_ATTACHMENT:
        return `tenants/${tenantId}/chat/attachments/${fileName}`;
      default:
        throw new BadRequestException('Unsupported upload type');
    }
  }
}
