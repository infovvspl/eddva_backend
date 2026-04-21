import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { v4 as uuidv4 } from 'uuid';
import { TenantId } from '../../common/decorators/auth.decorator';
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

  constructor(private readonly s3Service: S3Service) {}

  @Post('upload-url')
  @ApiOperation({ summary: 'Generate a tenant-scoped pre-signed S3 PUT URL' })
  async getUploadUrl(
    @Body() dto: GenerateUploadUrlDto,
    @TenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID could not be determined from the authenticated user');
    }

    this.validateFileSize(dto.type, dto.fileSize);
    this.validateRequiredFields(dto);
    this.validateContentType(dto.type, dto.contentType);

    const key = this.buildKey(tenantId, dto);
    return this.s3Service.presign(key, dto.contentType);
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
        : UploadController.MAX_STANDARD_FILE_SIZE;

    if (fileSize > maxBytes) {
      const limitLabel = type === UploadType.LECTURE_VIDEO
        ? '2 GB'
        : type === UploadType.MATERIAL
          ? '100 MB'
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
      default:
        throw new BadRequestException('Unsupported upload type');
    }
  }
}
