import {
  Controller,
  Post,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { S3Service } from './s3.service';
import { GenerateUploadUrlDto, UploadType } from './dto/upload.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/auth.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly s3Service: S3Service) {}

  // ── Generate pre-signed PUT URL ───────────────────────────────────────────

  @Post('url')
  @ApiOperation({ summary: 'Get a pre-signed S3 URL — client uploads directly, then confirms with fileUrl' })
  async getUploadUrl(
    @Body() dto: GenerateUploadUrlDto,
    @TenantId() tenantId: string,
  ) {
    if (!tenantId) throw new BadRequestException('Tenant ID could not be determined');

    const isVideo = dto.type === UploadType.LECTURE_VIDEO;
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB for non-video
    if (!isVideo && dto.fileSize > MAX_SIZE) {
      throw new BadRequestException('File size must be less than 10 MB');
    }

    this.validateContentType(dto.type, dto.contentType);

    const key = this.buildKey(tenantId, dto);
    return this.s3Service.presign(key, dto.contentType);
  }

  // ── Delete a file from S3 ─────────────────────────────────────────────────

  @Delete('file')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  @ApiOperation({ summary: 'Delete a file from S3 by its key (admins / teachers only)' })
  async deleteFile(
    @Body('key') key: string,
    @TenantId() tenantId: string,
  ) {
    if (!key) throw new BadRequestException('key is required');

    // Prevent cross-tenant deletions — key must belong to this tenant
    if (!key.startsWith(`tenants/${tenantId}/`)) {
      throw new BadRequestException('You can only delete files that belong to your tenant');
    }

    await this.s3Service.delete(key);
    return { deleted: true, key };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private validateContentType(type: UploadType, contentType: string) {
    switch (type) {
      case UploadType.PROFILE:
      case UploadType.THUMBNAIL:
      case UploadType.LECTURE_THUMBNAIL:
        if (!contentType.startsWith('image/'))
          throw new BadRequestException('Content type must be an image');
        break;
      case UploadType.MATERIAL:
      case UploadType.LECTURE_ATTACHMENT:
        if (contentType !== 'application/pdf' && !contentType.startsWith('image/'))
          throw new BadRequestException('Materials must be PDF or image');
        break;
      case UploadType.SOURCE:
        if (contentType !== 'application/zip' && contentType !== 'application/x-zip-compressed')
          throw new BadRequestException('Source files must be ZIP archives');
        break;
      case UploadType.LECTURE_VIDEO:
        if (!contentType.startsWith('video/'))
          throw new BadRequestException('Lectures must be video format');
        break;
    }
  }

  private buildKey(tenantId: string, dto: GenerateUploadUrlDto): string {
    const safe = dto.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const filename = `${Date.now()}-${uuidv4().slice(0, 8)}-${safe}`;

    switch (dto.type) {
      case UploadType.PROFILE:
        return `tenants/${tenantId}/admin/profile/${filename}`;
      case UploadType.THUMBNAIL:
        if (!dto.courseId) throw new BadRequestException('courseId required for thumbnail');
        return `tenants/${tenantId}/courses/${dto.courseId}/thumbnail/${filename}`;
      case UploadType.MATERIAL:
        if (!dto.courseId) throw new BadRequestException('courseId required for material');
        return `tenants/${tenantId}/courses/${dto.courseId}/materials/${filename}`;
      case UploadType.SOURCE:
        if (!dto.courseId) throw new BadRequestException('courseId required for source');
        return `tenants/${tenantId}/courses/${dto.courseId}/source/${filename}`;
      case UploadType.LECTURE_VIDEO:
        if (!dto.lectureId) throw new BadRequestException('lectureId required for video');
        return `tenants/${tenantId}/lectures/${dto.lectureId}/video/${filename}`;
      case UploadType.LECTURE_THUMBNAIL:
        if (!dto.lectureId) throw new BadRequestException('lectureId required for lecture thumbnail');
        return `tenants/${tenantId}/lectures/${dto.lectureId}/thumbnail/${filename}`;
      case UploadType.LECTURE_ATTACHMENT:
        if (!dto.lectureId) throw new BadRequestException('lectureId required for attachment');
        return `tenants/${tenantId}/lectures/${dto.lectureId}/attachments/${filename}`;
      default:
        throw new BadRequestException('Invalid upload type');
    }
  }
}
