import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { S3Service } from './s3.service';
import { GenerateUploadUrlDto, UploadType } from './dto/upload.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { v4 as uuidv4 } from 'uuid';

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly s3Service: S3Service) {}

  @Post('url')
  async getUploadUrl(
    @Body() dto: GenerateUploadUrlDto,
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID could not be determined.');
    }

    // 1. Validate File Size
    const isVideo = dto.type === UploadType.LECTURE_VIDEO;
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (!isVideo && dto.fileSize > MAX_SIZE) {
      throw new BadRequestException('File size must be less than 10MB.');
    }

    // 2. Validate Content Type
    this.validateContentType(dto.type, dto.contentType);

    // 3. Validate Context IDs and construct Key
    const key = this.generateS3Key(tenantId, dto);

    // 4. Generate Pre-signed URL
    return this.s3Service.presign(key, dto.contentType);
  }

  private validateContentType(type: UploadType, contentType: string) {
    switch (type) {
      case UploadType.PROFILE:
      case UploadType.THUMBNAIL:
      case UploadType.LECTURE_THUMBNAIL:
        if (!contentType.startsWith('image/')) {
          throw new BadRequestException('Content type must be an image.');
        }
        break;
      case UploadType.MATERIAL:
      case UploadType.LECTURE_ATTACHMENT:
        if (contentType !== 'application/pdf' && !contentType.startsWith('image/')) {
          throw new BadRequestException('Materials must be PDF or an image.');
        }
        break;
      case UploadType.SOURCE:
        if (
          contentType !== 'application/zip' &&
          contentType !== 'application/x-zip-compressed'
        ) {
          throw new BadRequestException('Source files must be ZIP archives.');
        }
        break;
      case UploadType.LECTURE_VIDEO:
        if (!contentType.startsWith('video/')) {
          throw new BadRequestException('Lectures must be video formats.');
        }
        break;
    }
  }

  private generateS3Key(tenantId: string, dto: GenerateUploadUrlDto): string {
    const timestamp = Date.now();
    const uniqueId = uuidv4();
    // Sanitize filename
    const safeOriginalName = dto.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const filename = `${timestamp}-${uniqueId}-${safeOriginalName}`;

    switch (dto.type) {
      case UploadType.PROFILE:
        return `tenants/${tenantId}/admin/profile/${filename}`;
      case UploadType.THUMBNAIL:
        if (!dto.courseId) throw new BadRequestException('courseId is required for thumbnail uploads.');
        return `tenants/${tenantId}/courses/${dto.courseId}/thumbnail/${filename}`;
      case UploadType.MATERIAL:
        if (!dto.courseId) throw new BadRequestException('courseId is required for material uploads.');
        return `tenants/${tenantId}/courses/${dto.courseId}/materials/${filename}`;
      case UploadType.SOURCE:
        if (!dto.courseId) throw new BadRequestException('courseId is required for source uploads.');
        return `tenants/${tenantId}/courses/${dto.courseId}/source/${filename}`;
      case UploadType.LECTURE_VIDEO:
        if (!dto.lectureId) throw new BadRequestException('lectureId is required for video uploads.');
        return `tenants/${tenantId}/lectures/${dto.lectureId}/video/${filename}`;
      case UploadType.LECTURE_THUMBNAIL:
        if (!dto.lectureId) throw new BadRequestException('lectureId is required for lecture thumbnail uploads.');
        return `tenants/${tenantId}/lectures/${dto.lectureId}/thumbnail/${filename}`;
      case UploadType.LECTURE_ATTACHMENT:
        if (!dto.lectureId) throw new BadRequestException('lectureId is required for lecture attachments.');
        return `tenants/${tenantId}/lectures/${dto.lectureId}/attachments/${filename}`;
      default:
        throw new BadRequestException('Invalid upload type.');
    }
  }
}
