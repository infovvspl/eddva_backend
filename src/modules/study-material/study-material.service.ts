import {
  Injectable, NotFoundException, ForbiddenException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { PDFDocument } from 'pdf-lib';

import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';
import { StudyMaterial } from './study-material.entity';
import {
  CreateStudyMaterialDto, UpdateStudyMaterialDto, ListStudyMaterialDto,
} from './dto/study-material.dto';
import { S3Service } from '../upload/s3.service';
import { Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';

// How long a signed download URL stays valid.
const DOWNLOAD_URL_TTL_SECONDS = 900; // 15 min

@Injectable()
export class StudyMaterialService {
  private readonly logger = new Logger(StudyMaterialService.name);

  constructor(
    @InjectRepository(StudyMaterial)
    private readonly repo: Repository<StudyMaterial>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    private readonly s3: S3Service,
  ) {}

  // ── Admin ─────────────────────────────────────────────────────────────────

  async create(dto: CreateStudyMaterialDto, tenantId: string, userId: string) {
    const mat = this.repo.create({
      ...dto,
      tenantId,
      uploadedBy: userId,
      previewPages: dto.previewPages ?? 2,
    });
    return this.repo.save(mat);
  }

  async update(id: string, dto: UpdateStudyMaterialDto, tenantId: string) {
    const mat = await this.findOneOrFail(id, tenantId);
    Object.assign(mat, dto);
    return this.repo.save(mat);
  }

  async remove(id: string, tenantId: string) {
    const mat = await this.findOneOrFail(id, tenantId);
    await this.s3.delete(mat.s3Key);
    await this.repo.remove(mat);
    return { deleted: true };
  }

  async adminList(tenantId: string, query: ListStudyMaterialDto) {
    return this.buildQuery(tenantId, query, false);
  }

  // ── Public / Student ───────────────────────────────────────────────────────

  async list(tenantId: string, query: ListStudyMaterialDto) {
    const items = await this.buildQuery(tenantId, query, true);
    // Strip s3Key from public listing response
    return items.map(({ s3Key: _k, ...rest }) => rest);
  }

  /**
   * Returns first N pages of the PDF as a Buffer.
   * This is the ONLY way an unauthenticated/non-enrolled user sees the content —
   * they never get the real S3 key or URL.
   */
  async getPreviewBuffer(id: string, tenantId: string): Promise<{ buffer: Buffer; pages: number }> {
    const mat = await this.findOneOrFail(id, tenantId);
    return this.buildPreviewFromMaterial(mat);
  }

  /**
   * Public marketplace preview — resolves material by id only (any institute), no tenant header.
   */
  async getPublicPreviewBuffer(id: string): Promise<{ buffer: Buffer; pages: number }> {
    const mat = await this.findPublicOrFail(id);
    return this.buildPreviewFromMaterial(mat);
  }

  private async buildPreviewFromMaterial(mat: StudyMaterial): Promise<{ buffer: Buffer; pages: number }> {
    const fullBuffer = await this.s3.getBuffer(mat.s3Key);
    const srcDoc = await PDFDocument.load(fullBuffer);

    const previewCount = Math.min(mat.previewPages, srcDoc.getPageCount());
    const previewDoc = await PDFDocument.create();
    const pages = await previewDoc.copyPages(srcDoc, Array.from({ length: previewCount }, (_, i) => i));
    pages.forEach(p => previewDoc.addPage(p));

    const buffer = Buffer.from(await previewDoc.save());
    return { buffer, pages: previewCount };
  }

  /**
   * Returns a 15-min pre-signed S3 GET URL — only if the student has an
   * active enrollment in this tenant.
   */
  async getDownloadUrl(
    id: string,
    tenantId: string,
    studentId: string,
  ): Promise<{ url: string; expiresIn: number }> {
    await this.findOneOrFail(id, tenantId);
    await this.assertEnrolled(studentId, tenantId);

    const mat = await this.findOneOrFail(id, tenantId);
    const url = await this.s3.presignGet(mat.s3Key, DOWNLOAD_URL_TTL_SECONDS);
    return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
  }

  /**
   * Returns whether the calling user is enrolled.
   * Used by the frontend to decide whether to show "Buy Course" or "Download" UI.
   */
  async accessStatus(tenantId: string, studentId: string): Promise<{ enrolled: boolean }> {
    const enrolled = await this.hasActiveEnrollment(studentId, tenantId);
    return { enrolled };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findOneOrFail(id: string, tenantId: string) {
    const mat = await this.repo.findOne({ where: { id, tenantId } });
    if (!mat) throw new NotFoundException('Study material not found');
    return mat;
  }

  /** Active material from a non-suspended tenant (for public / cross-tenant preview). */
  private async findPublicOrFail(id: string): Promise<StudyMaterial> {
    const mat = await this.repo
      .createQueryBuilder('m')
      .innerJoin(Tenant, 't', 't.id = m.tenant_id::uuid')
      .where('m.id = :id', { id })
      .andWhere('m.isActive = :active', { active: true })
      .andWhere('t.status IN (:...ok)', { ok: [TenantStatus.ACTIVE, TenantStatus.TRIAL] })
      .getOne();
    if (!mat) throw new NotFoundException('Study material not found');
    return mat;
  }

  private async buildQuery(tenantId: string, query: ListStudyMaterialDto, activeOnly: boolean) {
    const where: any = { tenantId };
    if (activeOnly) where.isActive = true;
    if (query.exam)    where.exam    = query.exam;
    if (query.type)    where.type    = query.type;
    if (query.subject) where.subject = ILike(`%${query.subject}%`);
    if (query.search) {
      return this.repo.find({
        where: [
          { ...where, title:   ILike(`%${query.search}%`) },
          { ...where, chapter: ILike(`%${query.search}%`) },
        ],
        order: { sortOrder: 'ASC', createdAt: 'DESC' },
      });
    }
    return this.repo.find({ where, order: { sortOrder: 'ASC', createdAt: 'DESC' } });
  }

  private async hasActiveEnrollment(studentId: string, tenantId: string): Promise<boolean> {
    const count = await this.enrollmentRepo.count({
      where: { studentId, tenantId, status: EnrollmentStatus.ACTIVE },
    });
    return count > 0;
  }

  private async assertEnrolled(studentId: string, tenantId: string) {
    const ok = await this.hasActiveEnrollment(studentId, tenantId);
    if (!ok) {
      throw new ForbiddenException(
        'You must be enrolled in a course to download study materials. Please purchase a course first.',
      );
    }
  }
}
