import {
  Injectable, NotFoundException, ForbiddenException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, ILike } from 'typeorm';
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
    private readonly dataSource: DataSource,
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

  /**
   * One-time repair utility:
   * Copies already uploaded topic resources (pdf/notes/pyq/dpp) into study_materials.
   */
  async backfillFromTopicResources(tenantId: string) {
    const rows: Array<{
      tenant_id: string;
      uploaded_by: string;
      title: string;
      description: string | null;
      type: string;
      file_url: string;
      file_size_kb: number | null;
      sort_order: number | null;
      subject_name: string | null;
      chapter_name: string | null;
      exam_target: string | null;
    }> = await this.dataSource.query(
      `
      SELECT
        tr.tenant_id,
        tr.uploaded_by,
        tr.title,
        tr.description,
        tr.type,
        tr.file_url,
        tr.file_size_kb,
        tr.sort_order,
        s.name AS subject_name,
        c.name AS chapter_name,
        s.exam_target
      FROM topic_resources tr
      JOIN topics t ON t.id = tr.topic_id
      JOIN chapters c ON c.id = t.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      WHERE tr.tenant_id = $1
        AND tr.is_active = true
        AND tr.file_url IS NOT NULL
        AND tr.type IN ('pdf', 'notes', 'pyq', 'dpp')
      `,
      [tenantId],
    );

    let inserted = 0;
    let skipped = 0;

    for (const r of rows) {
      const lowered = String(r.exam_target ?? '').toLowerCase();
      const exams: Array<'jee' | 'neet'> =
        lowered.includes('both') || (lowered.includes('jee') && lowered.includes('neet'))
          ? ['jee', 'neet']
          : lowered.includes('jee')
            ? ['jee']
            : lowered.includes('neet')
              ? ['neet']
              : [];
      if (exams.length === 0) {
        skipped += 1;
        continue;
      }

      const mappedType =
        r.type === 'pyq' ? 'pyq'
          : r.type === 'dpp' ? 'dpp'
            : r.type === 'notes' || r.type === 'pdf' ? 'notes'
              : null;
      if (!mappedType) {
        skipped += 1;
        continue;
      }

      let s3Key = '';
      try {
        s3Key = this.s3.keyFromUrl(r.file_url);
      } catch {
        skipped += 1;
        continue;
      }
      if (!s3Key) {
        skipped += 1;
        continue;
      }

      for (const exam of exams) {
        const exists = await this.repo.exist({
          where: { tenantId: r.tenant_id, s3Key, exam: exam as any },
        });
        if (exists) {
          skipped += 1;
          continue;
        }

        const row = this.repo.create({
          tenantId: r.tenant_id,
          exam: exam as any,
          type: mappedType as any,
          title: r.title,
          subject: r.subject_name ?? undefined,
          chapter: r.chapter_name ?? undefined,
          description: r.description ?? undefined,
          s3Key,
          fileSizeKb: r.file_size_kb ?? undefined,
          totalPages: undefined,
          previewPages: 2,
          uploadedBy: r.uploaded_by,
          isActive: true,
          sortOrder: r.sort_order ?? 0,
        });
        await this.repo.save(row);
        inserted += 1;
      }
    }

    return { tenantId, scanned: rows.length, inserted, skipped };
  }

  /**
   * Debug helper to compare source uploads vs catalog rows for a tenant.
   * Useful when UI returns success + empty data.
   */
  async debugStats(tenantId: string) {
    const [studyMaterialByExam, studyMaterialByType, topicResourceByType] = await Promise.all([
      this.dataSource.query(
        `
        SELECT exam, COUNT(*)::int AS count
        FROM study_materials
        WHERE tenant_id = $1 AND is_active = true
        GROUP BY exam
        ORDER BY exam ASC
        `,
        [tenantId],
      ),
      this.dataSource.query(
        `
        SELECT type, COUNT(*)::int AS count
        FROM study_materials
        WHERE tenant_id = $1 AND is_active = true
        GROUP BY type
        ORDER BY type ASC
        `,
        [tenantId],
      ),
      this.dataSource.query(
        `
        SELECT tr.type, COUNT(*)::int AS count
        FROM topic_resources tr
        WHERE tr.tenant_id = $1
          AND tr.is_active = true
          AND tr.file_url IS NOT NULL
        GROUP BY tr.type
        ORDER BY tr.type ASC
        `,
        [tenantId],
      ),
    ]);

    const [studyMaterialsTotalRow, topicResourcesTotalRow] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM study_materials WHERE tenant_id = $1 AND is_active = true`,
        [tenantId],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM topic_resources WHERE tenant_id = $1 AND is_active = true AND file_url IS NOT NULL`,
        [tenantId],
      ),
    ]);

    return {
      tenantId,
      totals: {
        studyMaterials: studyMaterialsTotalRow?.[0]?.count ?? 0,
        topicResources: topicResourcesTotalRow?.[0]?.count ?? 0,
      },
      studyMaterials: {
        byExam: studyMaterialByExam,
        byType: studyMaterialByType,
      },
      topicResources: {
        byType: topicResourceByType,
      },
      hint:
        'If topicResources > 0 and studyMaterials == 0, run POST /admin/study-materials/backfill-topic-resources',
    };
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
