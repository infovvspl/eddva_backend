import {
    Injectable,
    Inject,
    Logger,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Like, FindOptionsWhere, In } from 'typeorm';

import { Subject, Chapter, Topic, TopicResource, ResourceType } from '../../database/entities/subject.entity';
import {
    Question,
    QuestionOption,
    QuestionType,
} from '../../database/entities/question.entity';
import {
    Lecture,
    LectureProgress,
    LectureType,
    LectureStatus,
    TranscriptStatus,
    AiStudySession,
    AiNoteImage,
} from '../../database/entities/learning.entity';
import { TopicProgress, TopicStatus, MockTest } from '../../database/entities/assessment.entity';
import { PlanItem, PlanItemStatus, PlanItemType, StudyPlan } from '../../database/entities/learning.entity';
import { Batch, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';
import { StudyMaterial, StudyMaterialExam, StudyMaterialType } from '../study-material/study-material.entity';

import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import { NotificationService } from '../notification/notification.service';
import { StudyPlanService } from '../study-plan/study-plan.service';
import { TenantAiFeatureService } from '../../common/services/tenant-ai-feature.service';
import { AskAiQuestionDto, CompleteAiStudyDto, CompleteAiQuizDto, UpdateAiStudyNotesDto } from './dto/ai-study.dto';
import { CreateSubjectDto, UpdateSubjectDto, SubjectQueryDto } from './dto/subject.dto';
import { CreateChapterDto, UpdateChapterDto } from './dto/chapter.dto';
import { CreateTopicDto, UpdateTopicDto } from './dto/topic.dto';
import { BulkImportCurriculumDto } from './dto/bulk-import.dto';
import { S3Service } from '../upload/s3.service';
import {
    CreateQuestionDto,
    UpdateQuestionDto,
    QuestionQueryDto,
    BulkCreateQuestionDto,
} from './dto/question.dto';
import {
    CreateLectureDto,
    UpdateLectureDto,
    LectureQueryDto,
    UpsertProgressDto,
} from './dto/lecture.dto';
// Package 1.3.1 fixed the ESM packaging. Use the standard import.
import { YoutubeTranscript } from 'youtube-transcript';
type YoutubeTranscriptApi = {
    fetchTranscript: (videoIdOrUrl: string, opts?: { lang?: string }) => Promise<{ text: string }[]>;
};

@Injectable()
export class ContentService {
    private readonly logger = new Logger(ContentService.name);
    private readonly GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
    private static readonly presetExamTargets = new Set(['jee', 'neet', 'both']);
    private static readonly hindiLikeLectureLanguages = new Set(['hi', 'hinglish', 'hi-in']);
    private static readonly odiaLectureLanguages = new Set(['od', 'odia', 'od-in', 'or', 'or-in']);

    private async _extractNoteImageSearchTerms(
        notes: string,
        language = 'en',
    ): Promise<Array<{ heading: string; searchTerm: string; caption: string }>> {
        const groqKey = process.env.GROQ_API_KEY || '';
        if (!groqKey) return [];

        try {
            const response = await fetch(this.GROQ_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${groqKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a JSON-only API that returns {"sections": [...]}.',
                        },
                        {
                            role: 'user',
                            content: `Given these lecture notes (Markdown), identify 3-4 major section headings (## or ###) that would benefit from an illustrative educational image.

For each section:
- "heading": copy the exact heading line from the notes (include the ## or ### prefix).
- "searchTerm": 4-7 English words, specific to that sub-topic, including a visual hint such as diagram, photograph, chart, illustration, map, microscope, or experiment.
- "caption": one sentence describing what the image shows and how it supports the section. ${language === 'od' ? 'Write the caption in Odia.' : ''}

Return ONLY: {"sections": [{"heading": "## Exact Heading", "searchTerm": "...", "caption": "..."}]}

NOTES:
${notes.slice(0, 4000)}`,
                        },
                    ],
                    temperature: 0.3,
                    max_tokens: 1024,
                }),
            });
            if (!response.ok) return [];
            const data: any = await response.json();
            const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
            const sections = parsed.sections || parsed;
            if (!Array.isArray(sections)) return [];
            return sections
                .slice(0, 4)
                .filter((section: any) =>
                    section?.heading && section?.searchTerm && typeof section.heading === 'string',
                )
                .map((section: any) => ({
                    heading: String(section.heading).trim(),
                    searchTerm: String(section.searchTerm).trim(),
                    caption: String(section.caption || section.searchTerm).trim(),
                }));
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Could not plan coaching note image searches: ${message}`);
            return [];
        }
    }

    private async _searchNoteImage(searchTerm: string, tenantId: string, language = 'en'): Promise<string | null> {
        const visualHints = ['diagram', 'photo', 'photograph', 'illustration', 'chart', 'map', 'microscope', 'experiment', 'figure'];

        try {
            let englishTerm = searchTerm;
            if (language === 'od' && /[\u0B00-\u0B7F]/.test(searchTerm)) {
                if (await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing')) {
                    const translated = await this.aiBridgeService.translateText(
                        { text: searchTerm, targetLanguage: 'en' },
                        tenantId,
                    ) as any;
                    englishTerm = String(
                        translated?.translatedText ?? translated?.text ?? translated?.translation ?? searchTerm,
                    ).trim() || searchTerm;
                }
            }

            const baseQuery = visualHints.some((hint) => englishTerm.toLowerCase().includes(hint))
                ? englishTerm
                : `${englishTerm} educational diagram`;
            const preferredQuery = language === 'od'
                ? `${baseQuery} with Odia labels`
                : baseQuery;
            const result = await this.aiBridgeService.searchEducationalImages(
                { query: preferredQuery, limit: 5, language },
                tenantId,
            );
            const preferred = result.images.slice(0, 3).find((image) => image?.imageUrl)?.imageUrl || null;
            if (preferred || language !== 'od') return preferred;

            const fallback = await this.aiBridgeService.searchEducationalImages(
                { query: baseQuery, limit: 5, language: 'en' },
                tenantId,
            );
            return fallback.images.slice(0, 3).find((image) => image?.imageUrl)?.imageUrl || null;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`SerpApi coaching note image search failed: ${message}`);
            return null;
        }
    }

    private async _storeSearchedNoteImage(
        imageUrl: string,
        tenantId: string,
        lectureId: string,
        fileStem: string,
    ): Promise<string | null> {
        try {
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    Referer: 'https://www.google.com/',
                    Accept: 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
                },
                signal: AbortSignal.timeout(12000),
            });
            if (!response.ok) return null;
            const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
            if (!contentType.startsWith('image/')) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length < 2048) return null;

            const extensionByMime: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp',
                'image/gif': 'gif',
            };
            const extension = extensionByMime[contentType] || 'jpg';
            const key = `tenants/${tenantId}/lecture-notes/${lectureId}/${fileStem}.${extension}`;
            await this.s3Service.upload(key, buffer, contentType);
            return this.s3Service.toPublicUrl(key);
        } catch {
            return null;
        }
    }

    private _insertSearchedImageAfterHeading(
        notes: string,
        heading: string,
        imageUrl: string,
        caption: string,
    ): string {
        const normalizeHeading = (value: string) => value
            .normalize('NFC')
            .replace(/^\s*#{1,6}\s*/, '')
            .replace(/[*_`~]/g, '')
            .replace(/^\s*\d+[.)-]?\s*/, '')
            .replace(/[：:|–—-]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        const headingText = normalizeHeading(heading);
        const lines = notes.split('\n');
        let index = lines.findIndex(
            (line) => /^\s*#{1,6}\s+/.test(line) && normalizeHeading(line) === headingText,
        );
        if (index === -1) {
            index = lines.findIndex((line) => {
                if (!/^\s*#{1,6}\s+/.test(line)) return false;
                const candidate = normalizeHeading(line);
                return candidate.includes(headingText) || headingText.includes(candidate);
            });
        }
        const safeCaption = caption.replace(/\]/g, '\\]');
        const imageMarkdown = `\n![${safeCaption}](${imageUrl})\n*${caption}*\n`;
        if (index === -1) {
            return `${notes.trimEnd()}\n\n${imageMarkdown.trim()}\n`;
        }
        lines.splice(index + 1, 0, imageMarkdown);
        return lines.join('\n');
    }

    private _stripEmbeddedNoteImages(notes: string): string {
        return notes
            .replace(/\n!\[.*?\]\(https?:\/\/.*?\)\n\*.*?\*\n/g, '\n')
            .replace(/\n\n!\[.*?\]\(https?:\/\/.*?\)\n/g, '\n');
    }

    private async _enrichCoachingNotesWithImageSearch(
        notes: string,
        lectureId: string,
        tenantId: string,
        language = 'en',
    ): Promise<{ notes: string; images: AiNoteImage[] }> {
        const sections = await this._extractNoteImageSearchTerms(notes, language);
        if (!sections.length) return { notes, images: [] };

        let enrichedNotes = notes;
        const images: AiNoteImage[] = [];
        for (let index = 0; index < sections.length; index += 1) {
            const section = sections[index];
            const sourceUrl = await this._searchNoteImage(section.searchTerm, tenantId, language);
            if (!sourceUrl) continue;
            const storedUrl = await this._storeSearchedNoteImage(
                sourceUrl,
                tenantId,
                lectureId,
                `${Date.now()}-${index}`,
            );
            if (!storedUrl) continue;

            enrichedNotes = this._insertSearchedImageAfterHeading(
                enrichedNotes,
                section.heading,
                storedUrl,
                section.caption,
            );
            images.push({
                url: storedUrl,
                caption: section.caption,
                section_heading: section.heading,
                prompt: section.searchTerm,
                provider: 'serpapi',
                model: 'google-images',
            });
            if (index < sections.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 600));
            }
        }
        return { notes: enrichedNotes, images };
    }

    private _enrichAndPersistCoachingNoteImages(
        notes: string,
        lectureId: string,
        tenantId: string,
        language = 'en',
    ): void {
        this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing')
            .then(enabled => {
                if (!enabled) return;
                void this._enrichCoachingNotesWithImageSearch(notes, lectureId, tenantId, language)
                    .then(async (enriched) => {
                        if (!enriched.images.length) return;
                        await this.lectureRepo.update(lectureId, {
                            aiNotesMarkdown: enriched.notes,
                            aiNoteImages: enriched.images,
                        });
                        this.logger.log(`Coaching notes enriched with ${enriched.images.length} searched image(s) for lecture ${lectureId}`);
                    })
                    .catch((error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        this.logger.warn(`Coaching note image search failed for lecture ${lectureId}: ${message}`);
                    });
            })
            .catch(e => this.logger.warn(`Failed to check ai_notes_image_enrichment flag: ${e}`));
    }

    constructor(
        @InjectRepository(Subject, 'coaching')
        private readonly subjectRepo: Repository<Subject>,
        @InjectRepository(Chapter, 'coaching')
        private readonly chapterRepo: Repository<Chapter>,
        @InjectRepository(Topic, 'coaching')
        private readonly topicRepo: Repository<Topic>,
        @InjectRepository(Question, 'coaching')
        private readonly questionRepo: Repository<Question>,
        @InjectRepository(QuestionOption, 'coaching')
        private readonly optionRepo: Repository<QuestionOption>,
        @InjectRepository(Lecture, 'coaching')
        private readonly lectureRepo: Repository<Lecture>,
        @InjectRepository(LectureProgress, 'coaching')
        private readonly progressRepo: Repository<LectureProgress>,
        @InjectRepository(Batch, 'coaching')
        private readonly batchRepo: Repository<Batch>,
        @InjectRepository(BatchSubjectTeacher, 'coaching')
        private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
        @InjectRepository(Enrollment, 'coaching')
        private readonly enrollmentRepo: Repository<Enrollment>,
        @InjectRepository(AiStudySession, 'coaching')
        private readonly aiStudyRepo: Repository<AiStudySession>,
        @InjectRepository(TopicProgress, 'coaching')
        private readonly topicProgressRepo: Repository<TopicProgress>,
        @InjectRepository(MockTest, 'coaching')
        private readonly mockTestRepo: Repository<MockTest>,
        @InjectRepository(StudyPlan, 'coaching')
        private readonly studyPlanRepo: Repository<StudyPlan>,
        @InjectRepository(PlanItem, 'coaching')
        private readonly planItemRepo: Repository<PlanItem>,
        @InjectRepository(TopicResource, 'coaching')
        private readonly topicResourceRepo: Repository<TopicResource>,
        @InjectRepository(StudyMaterial, 'coaching')
        private readonly studyMaterialRepo: Repository<StudyMaterial>,
        @InjectRepository(User, 'coaching')
        private readonly userRepo: Repository<User>,
        @InjectDataSource('coaching')
        private readonly dataSource: DataSource,
        private readonly aiBridgeService: AiBridgeService,
        private readonly notificationService: NotificationService,
        private readonly studyPlanService: StudyPlanService,
        private readonly s3Service: S3Service,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
        @InjectDataSource('school')
        private readonly schoolDataSource: DataSource,
        private readonly tenantAiFeatureService: TenantAiFeatureService,
    ) { }

    private async _tenantHasAiFeature(tenantId: string, feature: string): Promise<boolean> {
        return this.tenantAiFeatureService.checkFeature(tenantId, feature);
    }

    private normalizeSubjectExamTarget(value: string) {
        const cleaned = value.trim().replace(/\s+/g, ' ');
        if (!cleaned) {
            throw new BadRequestException('Exam target is required.');
        }

        const lowered = cleaned.toLowerCase();
        return ContentService.presetExamTargets.has(lowered) ? lowered : cleaned;
    }

    private async ensureEnglishLectureNotes(notes: string, tenantId: string): Promise<string> {
        const cleaned = notes.trim();
        if (!cleaned) return notes;

        try {
            if (!(await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing'))) {
                return cleaned;
            }

            const result = await this.aiBridgeService.translateText(
                { text: cleaned, targetLanguage: 'en' },
                tenantId,
            ) as any;

            const translated: string = result?.translatedText ?? result?.text ?? result?.translation ?? '';
            return translated.trim() || cleaned;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Failed to normalize lecture notes to English; storing original notes. ${msg}`);
            return cleaned;
        }
    }

    private normalizeLectureLanguage(language?: string | null): string {
        const normalized = String(language ?? 'en').trim().toLowerCase() || 'en';
        return ContentService.odiaLectureLanguages.has(normalized) ? 'od' : normalized;
    }

    private getAiProcessingLanguage(language?: string | null): 'en' | 'hi' | 'hinglish' | 'od' {
        const normalized = this.normalizeLectureLanguage(language);
        if (normalized === 'od') return 'od';
        if (normalized === 'hinglish') return 'hinglish';
        return ContentService.hindiLikeLectureLanguages.has(normalized) ? 'hi' : 'en';
    }

    // â”€â”€â”€ SUBJECTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private async bustContentCache(tenantId: string) {
        const gen = await this.cacheManager.get<number>(`coaching:content-gen:${tenantId}`) ?? 0;
        await this.cacheManager.set(`coaching:content-gen:${tenantId}`, gen + 1, 60 * 60 * 1000);
    }

    async createSubject(dto: CreateSubjectDto, tenantId: string): Promise<Subject> {
        this.logger.log(`Creating subject for tenant ${tenantId}`);
        const subject = this.subjectRepo.create({
            ...dto,
            tenantId,
            batchId: dto.batchId ?? null,
            examTarget: this.normalizeSubjectExamTarget(dto.examTarget),
        });
        return this.subjectRepo.save(subject);
    }

    async getSubjects(query: SubjectQueryDto, tenantId: string): Promise<Subject[]> {
        const gen = await this.cacheManager.get<number>(`coaching:content-gen:${tenantId}`) ?? 0;
        const cacheKey = `coaching:subjects:${tenantId}:${query.batchId ?? ''}:${query.examTarget ?? ''}:g${gen}`;
        const cached = await this.cacheManager.get<Subject[]>(cacheKey);
        if (cached) return cached;

        const where: FindOptionsWhere<Subject> = { tenantId, isActive: true };
        if (query.examTarget) where.examTarget = this.normalizeSubjectExamTarget(query.examTarget);

        // When a batchId is given, align with student curriculum resolution:
        // 1) Prefer subjects linked by subjects.batch_id (batch-scoped curriculum)
        // 2) If none, fall back to batch_subject_teachers name matching (legacy / global subjects)
        if (query.batchId) {
            const [batchLinked, assignments] = await Promise.all([
                this.subjectRepo.find({
                    where: { tenantId, batchId: query.batchId, isActive: true },
                    relations: ['chapters', 'chapters.topics'],
                    order: { sortOrder: 'ASC', name: 'ASC' },
                }),
                this.batchSubjectTeacherRepo.find({
                    where: { batchId: query.batchId },
                    select: ['subjectName'],
                }),
            ]);

            const tenantSubjects = await this.subjectRepo.find({
                where: { tenantId, isActive: true },
                relations: ['chapters', 'chapters.topics'],
                order: { sortOrder: 'ASC', name: 'ASC' },
            });

            const assignedNames = [...new Set(assignments.map(a => a.subjectName.toLowerCase().trim()))];

            // Merge batch-scoped subjects with BST/global matches so a course never "loses"
            // Chemistry/Biology when only some rows have subjects.batch_id set.
            const byName = new Map<string, Subject>();
            for (const s of batchLinked) {
                byName.set(s.name.toLowerCase().trim(), s);
            }
            for (const rawName of assignedNames) {
                const key = rawName.toLowerCase().trim();
                if (byName.has(key)) continue;
                const candidates = tenantSubjects.filter(s => s.name.toLowerCase().trim() === key);
                let pick: Subject | undefined;
                for (const c of candidates) {
                    if (c.batchId === null) {
                        pick = c;
                        break;
                    }
                }
                if (!pick && candidates.length) pick = candidates[0];
                if (pick) byName.set(key, pick);
            }

            // Subjects reached via lectures on this batch (often global `batch_id` rows) so admins
            // still see Chemistry/Biology trees even when `subjects.batch_id` only exists on Physics.
            const lectureSubjectRows: { id: string }[] = await this.dataSource.query(
                `
                SELECT DISTINCT s.id::text AS id
                FROM lectures l
                INNER JOIN topics t ON t.id = l.topic_id AND t.deleted_at IS NULL
                INNER JOIN chapters c ON c.id = t.chapter_id AND c.deleted_at IS NULL
                INNER JOIN subjects s ON s.id = c.subject_id AND s.deleted_at IS NULL
                WHERE l.batch_id = $1 AND l.deleted_at IS NULL
                  AND s.tenant_id = $2 AND s.is_active = true
                `,
                [query.batchId, tenantId],
            );
            const lecIds = [...new Set(lectureSubjectRows.map((r) => r.id).filter(Boolean))];
            if (lecIds.length) {
                const lecSubjects = await this.subjectRepo.find({
                    where: { id: In(lecIds), tenantId, isActive: true },
                    relations: ['chapters', 'chapters.topics'],
                });
                for (const s of lecSubjects) {
                    const key = s.name.toLowerCase().trim();
                    if (!byName.has(key)) byName.set(key, s);
                }
            }

            // Subjects that have topic files/links on this batch (or BST-listed name) even with no lectures yet
            const trSubjectRows: { id: string }[] = await this.dataSource.query(
                `
                SELECT DISTINCT s.id::text AS id
                FROM topic_resources tr
                INNER JOIN topics t ON t.id = tr.topic_id AND t.deleted_at IS NULL
                INNER JOIN chapters c ON c.id = t.chapter_id AND c.deleted_at IS NULL
                INNER JOIN subjects s ON s.id = c.subject_id AND s.deleted_at IS NULL
                WHERE tr.tenant_id = $2 AND tr.deleted_at IS NULL
                  AND s.tenant_id = $2 AND s.is_active = true
                  AND (
                    s.batch_id = $1
                    OR EXISTS (
                      SELECT 1 FROM batch_subject_teachers bst
                      WHERE bst.batch_id = $1
                        AND LOWER(TRIM(bst.subject_name)) = LOWER(TRIM(s.name))
                    )
                  )
                `,
                [query.batchId, tenantId],
            );
            const trIds = [...new Set(trSubjectRows.map((r) => r.id).filter(Boolean))];
            if (trIds.length) {
                const trSubjects = await this.subjectRepo.find({
                    where: { id: In(trIds), tenantId, isActive: true },
                    relations: ['chapters', 'chapters.topics'],
                });
                for (const s of trSubjects) {
                    const key = s.name.toLowerCase().trim();
                    if (!byName.has(key)) byName.set(key, s);
                }
            }

            if (byName.size > 0) {
                const subjectsResult = Array.from(byName.values()).sort(
                    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
                );
                await this.cacheManager.set(cacheKey, subjectsResult, 30 * 60 * 1000);
                return subjectsResult;
            }

            if (assignedNames.length === 0) {
                await this.cacheManager.set(cacheKey, [], 30 * 60 * 1000);
                return [];
            }

            const filtered = tenantSubjects.filter(s => assignedNames.includes(s.name.toLowerCase().trim()));
            const seen = new Map<string, Subject>();
            for (const s of filtered) {
                const key = s.name.toLowerCase().trim();
                if (!seen.has(key) || s.batchId === null) seen.set(key, s);
            }
            const filteredResult = Array.from(seen.values()).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
            await this.cacheManager.set(cacheKey, filteredResult, 30 * 60 * 1000);
            return filteredResult;
        }

        const all = await this.subjectRepo.find({
            where: { tenantId, isActive: true },
            relations: ['chapters', 'chapters.topics'],
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });

        // Deduplicate by name — prefer global (batchId = null) over batch-scoped copies
        const seen = new Map<string, Subject>();
        for (const s of all) {
            const key = s.name.toLowerCase().trim();
            if (!seen.has(key) || s.batchId === null) {
                seen.set(key, s);
            }
        }
        const allResult = Array.from(seen.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        await this.cacheManager.set(cacheKey, allResult, 30 * 60 * 1000);
        return allResult;
    }

    async getSubjectById(id: string, tenantId: string): Promise<Subject> {
        const gen = await this.cacheManager.get<number>(`coaching:content-gen:${tenantId}`) ?? 0;
        const cacheKey = `coaching:subject:${id}:${tenantId}:g${gen}`;
        const cached = await this.cacheManager.get<Subject>(cacheKey);
        if (cached) return cached;

        const subject = await this.subjectRepo.findOne({
            where: { id, tenantId },
            relations: ['chapters', 'chapters.topics'],
            order: { sortOrder: 'ASC' } as any,
        });
        if (!subject) throw new NotFoundException(`Subject ${id} not found`);
        await this.cacheManager.set(cacheKey, subject, 30 * 60 * 1000);
        return subject;
    }

    async updateSubject(id: string, dto: UpdateSubjectDto, tenantId: string): Promise<Subject> {
        this.logger.log(`Updating subject ${id} for tenant ${tenantId}`);
        const subject = await this.subjectRepo.findOne({ where: { id, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${id} not found`);
        Object.assign(subject, {
            ...dto,
            examTarget: dto.examTarget != null
                ? this.normalizeSubjectExamTarget(dto.examTarget)
                : subject.examTarget,
        });
        const saved = await this.subjectRepo.save(subject);
        await this.bustContentCache(tenantId);
        return saved;
    }

    async deleteSubject(id: string, tenantId: string): Promise<{ message: string }> {
        this.logger.log(`Soft deleting subject ${id} for tenant ${tenantId}`);
        const subject = await this.subjectRepo.findOne({ where: { id, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${id} not found`);
        await this.subjectRepo.softDelete(id);
        await this.bustContentCache(tenantId);
        return { message: 'Subject deleted successfully' };
    }

    // â”€â”€â”€ BULK CURRICULUM IMPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async bulkImportCurriculum(dto: BulkImportCurriculumDto, tenantId: string) {
        const { batchId, examTarget, subjects } = dto;

        // Verify batch belongs to this tenant
        const batch = await this.batchRepo.findOne({ where: { id: batchId, tenantId } });
        if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

        const resolvedExamTarget = (examTarget ?? batch.examTarget) as any;

        const stats = { subjects: 0, chapters: 0, topics: 0 };
        const skipped = { subjects: 0, chapters: 0, topics: 0 };
        const result: {
            id: string; name: string;
            chapters: { id: string; name: string; topics: { id: string; name: string }[] }[];
        }[] = [];

        await this.dataSource.transaction(async manager => {
            for (let si = 0; si < subjects.length; si++) {
                const sDef = subjects[si];

                // Upsert subject — match by name + batchId
                let subject = await manager.findOne(Subject, {
                    where: { tenantId, batchId, isActive: true, name: sDef.name },
                });
                if (!subject) {
                    subject = manager.create(Subject, {
                        name: sDef.name,
                        tenantId,
                        batchId,
                        examTarget: resolvedExamTarget,
                        colorCode: sDef.colorCode ?? null,
                        sortOrder: si,
                        isActive: true,
                    });
                    subject = await manager.save(Subject, subject);
                    stats.subjects++;
                } else {
                    skipped.subjects++;
                    if (sDef.colorCode) {
                        subject.colorCode = sDef.colorCode;
                        await manager.save(Subject, subject);
                    }
                }

                const subjectOut: typeof result[number] = { id: subject.id, name: subject.name, chapters: [] };

                for (let ci = 0; ci < sDef.chapters.length; ci++) {
                    const cDef = sDef.chapters[ci];

                    // Upsert chapter — match by name + subjectId
                    let chapter = await manager.findOne(Chapter, {
                        where: { tenantId, subjectId: subject.id, isActive: true, name: cDef.name },
                    });
                    if (!chapter) {
                        chapter = manager.create(Chapter, {
                            name: cDef.name,
                            tenantId,
                            subjectId: subject.id,
                            jeeWeightage: cDef.jeeWeightage ?? 0,
                            neetWeightage: cDef.neetWeightage ?? 0,
                            sortOrder: ci,
                            isActive: true,
                        });
                        chapter = await manager.save(Chapter, chapter);
                        stats.chapters++;
                    } else {
                        skipped.chapters++;
                        // Update weightages if provided
                        let dirty = false;
                        if (cDef.jeeWeightage != null) { chapter.jeeWeightage = cDef.jeeWeightage; dirty = true; }
                        if (cDef.neetWeightage != null) { chapter.neetWeightage = cDef.neetWeightage; dirty = true; }
                        if (dirty) await manager.save(Chapter, chapter);
                    }

                    const chapterOut: typeof subjectOut.chapters[number] = { id: chapter.id, name: chapter.name, topics: [] };

                    for (let ti = 0; ti < cDef.topics.length; ti++) {
                        const tDef = cDef.topics[ti];

                        // Upsert topic — match by name + chapterId
                        let topic = await manager.findOne(Topic, {
                            where: { tenantId, chapterId: chapter.id, isActive: true, name: tDef.name },
                        });
                        if (!topic) {
                            topic = manager.create(Topic, {
                                name: tDef.name,
                                tenantId,
                                chapterId: chapter.id,
                                estimatedStudyMinutes: tDef.estimatedStudyMinutes ?? 60,
                                sortOrder: ti,
                                gatePassPercentage: 70,
                                prerequisiteTopicIds: [],
                                isActive: true,
                            });
                            topic = await manager.save(Topic, topic);
                            stats.topics++;
                        } else {
                            skipped.topics++;
                            if (tDef.estimatedStudyMinutes != null) {
                                topic.estimatedStudyMinutes = tDef.estimatedStudyMinutes;
                                await manager.save(Topic, topic);
                            }
                        }

                        chapterOut.topics.push({ id: topic.id, name: topic.name });
                    }

                    subjectOut.chapters.push(chapterOut);
                }

                result.push(subjectOut);
            }
        });

        await this.bustContentCache(tenantId);
        return {
            message: `Import complete`,
            created: stats,
            skipped,
            curriculum: result,
        };
    }

    // â”€â”€â”€ CHAPTERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async createChapter(dto: CreateChapterDto, tenantId: string): Promise<Chapter> {
        this.logger.log(`Creating chapter for subject ${dto.subjectId}, tenant ${tenantId}`);
        // Validate parent subject belongs to this tenant
        const subject = await this.subjectRepo.findOne({ where: { id: dto.subjectId, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${dto.subjectId} not found`);

        const chapter = this.chapterRepo.create({ ...dto, tenantId });
        return this.chapterRepo.save(chapter);
    }

    async getChapters(subjectId: string, tenantId: string): Promise<Chapter[]> {
        const gen = await this.cacheManager.get<number>(`coaching:content-gen:${tenantId}`) ?? 0;
        const cacheKey = `coaching:chapters:${subjectId}:${tenantId}:g${gen}`;
        const cached = await this.cacheManager.get<Chapter[]>(cacheKey);
        if (cached) return cached;

        const subject = await this.subjectRepo.findOne({ where: { id: subjectId, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${subjectId} not found`);

        const chapters = await this.chapterRepo.find({
            where: { subjectId, tenantId, isActive: true },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
        await this.cacheManager.set(cacheKey, chapters, 30 * 60 * 1000);
        return chapters;
    }

    async updateChapter(id: string, dto: UpdateChapterDto, tenantId: string): Promise<Chapter> {
        const chapter = await this.chapterRepo.findOne({ where: { id, tenantId } });
        if (!chapter) throw new NotFoundException(`Chapter ${id} not found`);
        Object.assign(chapter, dto);
        const saved = await this.chapterRepo.save(chapter);
        await this.bustContentCache(tenantId);
        return saved;
    }

    async deleteChapter(id: string, tenantId: string): Promise<{ message: string }> {
        const chapter = await this.chapterRepo.findOne({ where: { id, tenantId } });
        if (!chapter) throw new NotFoundException(`Chapter ${id} not found`);
        await this.chapterRepo.softDelete(id);
        await this.bustContentCache(tenantId);
        return { message: 'Chapter deleted successfully' };
    }

    // â”€â”€â”€ TOPICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async createTopic(dto: CreateTopicDto, tenantId: string): Promise<Topic> {
        this.logger.log(`Creating topic for chapter ${dto.chapterId}, tenant ${tenantId}`);
        const chapter = await this.chapterRepo.findOne({
            where: { id: dto.chapterId, tenantId },
            relations: ['subject'],
        });
        if (!chapter) throw new NotFoundException(`Chapter ${dto.chapterId} not found`);

        const topic = this.topicRepo.create({ ...dto, tenantId });
        const saved = await this.topicRepo.save(topic);

        const batchId = chapter.subject?.batchId ?? null;
        this.studyPlanService.onTopicCreated(saved.id, batchId, tenantId).catch(() => { });

        return saved;
    }

    async getTopics(chapterId: string, tenantId: string): Promise<Topic[]> {
        const gen = await this.cacheManager.get<number>(`coaching:content-gen:${tenantId}`) ?? 0;
        const cacheKey = `coaching:topics:${chapterId}:${tenantId}:g${gen}`;
        const cached = await this.cacheManager.get<Topic[]>(cacheKey);
        if (cached) return cached;

        const chapter = await this.chapterRepo.findOne({ where: { id: chapterId, tenantId } });
        if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);

        const topics = await this.topicRepo.find({
            where: { chapterId, tenantId, isActive: true },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
        await this.cacheManager.set(cacheKey, topics, 30 * 60 * 1000);
        return topics;
    }

    async updateTopic(id: string, dto: UpdateTopicDto, tenantId: string): Promise<Topic> {
        const topic = await this.topicRepo.findOne({ where: { id, tenantId } });
        if (!topic) throw new NotFoundException(`Topic ${id} not found`);
        Object.assign(topic, dto);
        const saved = await this.topicRepo.save(topic);
        await this.bustContentCache(tenantId);
        return saved;
    }

    async deleteTopic(id: string, tenantId: string): Promise<{ message: string }> {
        const topic = await this.topicRepo.findOne({ where: { id, tenantId } });
        if (!topic) throw new NotFoundException(`Topic ${id} not found`);
        await this.topicRepo.softDelete(id);
        await this.bustContentCache(tenantId);
        return { message: 'Topic deleted successfully' };
    }

    // â”€â”€â”€ QUESTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private validateQuestionOptions(dto: CreateQuestionDto) {
        const { type, options = [], integerAnswer } = dto;

        if (type === QuestionType.INTEGER) {
            if (!integerAnswer) {
                throw new BadRequestException('integerAnswer is required for integer type questions');
            }
            if (options.length > 0) {
                throw new BadRequestException('Integer type questions must not have options');
            }
            return;
        }

        if (type === QuestionType.DESCRIPTIVE) {
            // options are optional/not needed for descriptive
            return;
        }

        // MCQ types — options required
        if (!options || options.length < 2) {
            throw new BadRequestException('MCQ questions require at least 2 options');
        }

        const correctOptions = options.filter((o) => o.isCorrect);
        if (type === QuestionType.MCQ_SINGLE && correctOptions.length !== 1) {
            throw new BadRequestException('mcq_single must have exactly one correct option');
        }
        if (type === QuestionType.MCQ_MULTI && correctOptions.length < 1) {
            throw new BadRequestException('mcq_multi must have at least one correct option');
        }
    }

    async createQuestion(dto: CreateQuestionDto, tenantId: string): Promise<Question> {
        this.logger.log(`Creating question for topic ${dto.topicId ?? 'none'}, tenant ${tenantId}`);
        this.validateQuestionOptions(dto);

        if (dto.topicId) {
            // Topics are platform-level content — do not filter by institute tenantId
            const topic = await this.topicRepo.findOne({ where: { id: dto.topicId } });
            if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);
        }

        return this.dataSource.transaction(async (manager) => {
            const { options: optionDtos = [], ...questionData } = dto;
            const question = manager.create(Question, { ...questionData, tenantId });
            const savedQuestion = await manager.save(question);

            if (optionDtos.length > 0) {
                const optionEntities = optionDtos.map((o) =>
                    manager.create(QuestionOption, { ...o, questionId: savedQuestion.id }),
                );
                await manager.save(optionEntities);
            }

            return manager.findOne(Question, {
                where: { id: savedQuestion.id },
                relations: ['options'],
            });
        });
    }

    async getQuestions(
        query: QuestionQueryDto,
        tenantId: string,
    ): Promise<{ data: Question[]; meta: any }> {
        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const qb = this.questionRepo
            .createQueryBuilder('q')
            .leftJoinAndSelect('q.options', 'options')
            .where('q.tenantId = :tenantId', { tenantId })
            .andWhere('q.isActive = true');

        if (query.topicId) qb.andWhere('q.topicId = :topicId', { topicId: query.topicId });
        if (query.difficulty) qb.andWhere('q.difficulty = :difficulty', { difficulty: query.difficulty });
        if (query.type) qb.andWhere('q.type = :type', { type: query.type });
        if (query.source) qb.andWhere('q.source = :source', { source: query.source });
        if (query.search) {
            qb.andWhere('q.content ILIKE :search', { search: `%${query.search}%` });
        }

        qb.orderBy('q.createdAt', 'DESC').skip(skip).take(limit);

        const [data, total] = await qb.getManyAndCount();
        return {
            data,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }

    async getQuestionById(id: string, tenantId: string): Promise<Question> {
        const question = await this.questionRepo.findOne({
            where: { id, tenantId },
            relations: ['options', 'topic'],
        });
        if (!question) throw new NotFoundException(`Question ${id} not found`);
        return question;
    }

    async updateQuestion(id: string, dto: UpdateQuestionDto, tenantId: string): Promise<Question> {
        this.logger.log(`Updating question ${id} for tenant ${tenantId}`);
        const question = await this.questionRepo.findOne({ where: { id, tenantId } });
        if (!question) throw new NotFoundException(`Question ${id} not found`);

        return this.dataSource.transaction(async (manager) => {
            const { options: optionDtos, ...questionData } = dto;
            Object.assign(question, questionData);
            await manager.save(question);

            if (optionDtos !== undefined) {
                // Replace all options
                await manager.delete(QuestionOption, { questionId: id });
                if (optionDtos.length > 0) {
                    const optionEntities = optionDtos.map((o) =>
                        manager.create(QuestionOption, { ...o, questionId: id }),
                    );
                    await manager.save(optionEntities);
                }
            }

            return manager.findOne(Question, { where: { id }, relations: ['options', 'topic'] });
        });
    }

    async deleteQuestion(id: string, tenantId: string): Promise<{ message: string }> {
        const question = await this.questionRepo.findOne({ where: { id, tenantId } });
        if (!question) throw new NotFoundException(`Question ${id} not found`);
        await this.questionRepo.softDelete(id);
        return { message: 'Question deleted successfully' };
    }

    async bulkCreateQuestions(
        dto: BulkCreateQuestionDto,
        tenantId: string,
    ): Promise<{ created: number; failed: number; errors: any[] }> {
        this.logger.log(`Bulk creating ${dto.questions.length} questions for tenant ${tenantId}`);
        let created = 0;
        let failed = 0;
        const errors: any[] = [];

        for (let i = 0; i < dto.questions.length; i++) {
            const q = dto.questions[i];
            try {
                this.validateQuestionOptions(q);
                await this.createQuestion(q, tenantId);
                created++;
            } catch (err) {
                failed++;
                errors.push({ index: i, content: q.content?.substring(0, 60), error: err.message });
            }
        }

        return { created, failed, errors };
    }

    // â”€â”€â”€ LECTURES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private async validateBatchAccess(batchId: string, userId: string, tenantId: string, isAdminOrAbove: boolean) {
        const batch = await this.batchRepo.findOne({ where: { id: batchId, tenantId } });
        if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

        if (!isAdminOrAbove) {
            // Allow: primary batch teacher OR any subject teacher assigned to this batch
            const isPrimaryTeacher = batch.teacherId === userId;
            const isSubjectTeacher = await this.batchSubjectTeacherRepo.findOne({
                where: { batchId, tenantId, teacherId: userId },
            });
            if (!isPrimaryTeacher && !isSubjectTeacher) {
                throw new ForbiddenException('You are not assigned to this batch');
            }
        }
        return batch;
    }

    async createLecture(
        dto: CreateLectureDto,
        userId: string,
        tenantId: string,
        isAdmin: boolean,
    ): Promise<Lecture> {
        const lectureLanguage = this.normalizeLectureLanguage(dto.lectureLanguage);
        this.logger.log(
            `Creating lecture for batch ${dto.batchId}, tenant ${tenantId}, lectureLanguage=${lectureLanguage} raw=${dto.lectureLanguage ?? 'unset'}`,
        );

        await this.validateBatchAccess(dto.batchId, userId, tenantId, isAdmin);

        // Validate type-specific fields
        if (dto.type === LectureType.RECORDED && !dto.videoUrl) {
            throw new BadRequestException('videoUrl is required for recorded lectures');
        }
        if (dto.type === LectureType.LIVE) {
            if (!dto.scheduledAt) throw new BadRequestException('scheduledAt is required for live lectures');
        }

        const status =
            dto.type === LectureType.LIVE ? LectureStatus.SCHEDULED : LectureStatus.PUBLISHED;

        const finalTeacherId = (isAdmin && dto.teacherId) ? dto.teacherId : userId;

        const lecture = this.lectureRepo.create({
            ...dto,
            lectureLanguage,
            transcriptLanguage: lectureLanguage,
            tenantId,
            teacherId: finalTeacherId,
            status,
        });
        const saved = await this.lectureRepo.save(lecture);

        if (dto.type === LectureType.RECORDED && dto.videoUrl) {
            // Only run transcription / AI notes if the tenant has the STT feature
            void (async () => {
                try {
                    const enabled = await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing');
                    if (enabled) {
                        await this._processLectureAI(saved.id, dto.videoUrl, dto.topicId, tenantId);
                    } else {
                        // No AI: clear transcript status so the UI never shows a perpetual "pending"
                        await this.lectureRepo.update(saved.id, { transcriptStatus: null as any });
                    }
                } catch { /* background task — swallow */ }
            })();
            this._notifyStudentsOnPublish(saved).catch(() => { });
        }

        if (dto.type === LectureType.LIVE && saved.scheduledAt) {
            this.notifyEnrolledStudentsLiveClass(saved, tenantId).catch((err) =>
                this.logger.warn(
                    `live class notify failed: ${err instanceof Error ? err.message : String(err)}`,
                ),
            );
        }

        return saved;
    }

    private async notifyEnrolledStudentsLiveClass(lecture: Lecture, tenantId: string): Promise<void> {
        const [enrollments, teacher] = await Promise.all([
            this.enrollmentRepo.find({
                where: { batchId: lecture.batchId, status: EnrollmentStatus.ACTIVE },
                relations: ['student', 'student.user'],
            }),
            this.userRepo.findOne({ where: { id: lecture.teacherId } }),
        ]);

        const teacherName = teacher?.fullName ?? 'Your teacher';
        const when = lecture.scheduledAt
            ? new Date(lecture.scheduledAt).toLocaleString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
            })
            : '';

        const payloads = enrollments
            .map((e) => {
                const userId = e.student?.userId ?? e.student?.user?.id;
                if (!userId) return null;
                return {
                    userId,
                    tenantId: e.student?.user?.tenantId ?? tenantId,
                    title: `Live class scheduled: ${lecture.title}`,
                    body: `${teacherName} scheduled a live class${when ? ` — ${when}` : ''}. Open Calendar or Lectures to join.`,
                    channels: ['in_app', 'push'] as ('in_app' | 'push')[],
                    refType: 'live_class_scheduled',
                    refId: lecture.id,
                };
            })
            .filter((p): p is NonNullable<typeof p> => p !== null);

        if (payloads.length > 0) {
            await this.notificationService.sendBatch(payloads);
        }
    }

    private _fixVideoUrl(url: string): string {
        // "http://host/api/v1http://host/uploads/..." â†’ "http://host/uploads/..."
        const doubleUrl = url.match(/https?:\/\/[^/]+\/api\/v\d+(https?:\/\/.+)/);
        if (doubleUrl) return doubleUrl[1];
        // "http://host/api/v1/uploads/..." â†’ "http://host/uploads/..."
        return url.replace(/\/api\/v\d+\/uploads\//, '/uploads/');
    }

    async promoteLectureToRecorded(
        lectureId: string,
        videoUrl: string,
        tenantId: string,
        opts?: { notifyStudents?: boolean; triggerAi?: boolean },
    ): Promise<Lecture> {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const cleanUrl = this._fixVideoUrl(videoUrl.trim());
        const wasPublished = lecture.status === LectureStatus.PUBLISHED;

        const sttEnabled = await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing');

        lecture.videoUrl = cleanUrl;
        lecture.type = LectureType.RECORDED;
        lecture.status = LectureStatus.PUBLISHED;
        lecture.transcriptStatus = sttEnabled ? TranscriptStatus.PENDING : (null as any);
        lecture.transcript = null as any;
        lecture.transcriptHi = null as any;
        lecture.aiNotesMarkdown = null as any;
        lecture.aiKeyConcepts = [];
        lecture.aiFormulas = [];
        lecture.aiNoteImages = [];
        lecture.quizCheckpoints = [];

        const saved = await this.lectureRepo.save(lecture);

        if (!wasPublished && saved.batchId && opts?.notifyStudents !== false) {
            this._notifyStudentsOnPublish(saved).catch(err =>
                this.logger.warn(`Failed to send publish notifications for lecture ${saved.id}: ${err.message}`),
            );
        }

        // Only transcribe if the tenant has STT enabled AND caller didn't opt out
        if (opts?.triggerAi !== false && sttEnabled) {
            this._processLectureAI(saved.id, cleanUrl, saved.topicId, tenantId).catch(err =>
                this.logger.warn(`Failed to start AI processing for lecture ${saved.id}: ${err instanceof Error ? err.message : String(err)}`),
            );
        }

        return saved;
    }

    // â”€â”€ YouTube helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private isYouTubeUrl(url: string): boolean {
        return /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)/.test(url);
    }

    private extractYouTubeId(url: string): string | null {
        const m =
            url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
            url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
            url.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    /**
     * Load youtube-transcript.
     */
    private async loadYoutubeTranscriptApi(): Promise<YoutubeTranscriptApi> {
        const mod = await import('youtube-transcript');
        const api = (mod as { YoutubeTranscript?: YoutubeTranscriptApi }).YoutubeTranscript;
        if (!api) throw new Error('Failed to load youtube-transcript ESM API');
        return api;
    }

    /**
     * Fetch the auto-generated or manual captions for a YouTube video and join
     * them into one plain-text transcript string.
     *
     * Tries English first; if unavailable, lets the library pick the first
     * available language so we always get something.
     */
    private async _fetchYouTubeTranscript(videoId: string): Promise<string> {
        const youtubeTranscript = await this.loadYoutubeTranscriptApi();
        let segments: { text: string }[];
        try {
            segments = await youtubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        } catch {
            // Retry without a lang preference — takes whatever YouTube makes available
            segments = await youtubeTranscript.fetchTranscript(videoId);
        }
        if (!segments || segments.length === 0) {
            throw new Error(`YouTube captions are empty for video ${videoId}`);
        }
        return segments
            .map(s => s.text.replace(/\[.*?\]/g, '').trim())  // strip [Music], [Applause] etc.
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Full AI pipeline for a YouTube lecture:
     *   1. Fetch captions via the YouTube transcript API (no yt-dlp, no OAuth)
     *   2. Send plain-text transcript to the LLM summariser (bypass Whisper)
     *   3. Persist transcript + AI notes to the DB
     */
    private async _processYouTubeLecture(
        lectureId: string,
        videoId: string,
        topicId: string | undefined,
        tenantId: string,
    ): Promise<void> {
        const current = await this.lectureRepo.findOne({
            where: { id: lectureId },
            select: ['id', 'status', 'lectureLanguage'],
        });
        const isNewLecture = current?.status === LectureStatus.PROCESSING;
        const lectureLanguage = this.normalizeLectureLanguage(current?.lectureLanguage);

        this.logger.log(`YouTube AI processing started for lecture ${lectureId} videoId=${videoId}`);
        await this.lectureRepo.update(lectureId, { transcriptStatus: TranscriptStatus.PROCESSING });

        // Delegate caption-fetch + LLM to Django (uses Python youtube-transcript-api,
        // which works on server/VPS IPs unlike the npm youtube-transcript package).
        try {
            const result = await this.aiBridgeService.generateNotesFromYouTube(
                {
                    videoId,
                    topicId: topicId ?? '',
                    language: lectureLanguage as 'en' | 'hi' | 'hinglish' | 'hi-in' | 'od',
                },
                tenantId,
            ) as any;

            const rawTranscript: string | null = result?.rawTranscript ?? result?.transcript ?? null;
            const englishTranscript: string | null = result?.englishTranscript ?? null;
            const transcriptToStore = (englishTranscript && englishTranscript !== rawTranscript)
                ? englishTranscript : (rawTranscript ?? '');

            const updates: Partial<Lecture> = {
                status: isNewLecture ? LectureStatus.DRAFT : (current?.status ?? LectureStatus.PUBLISHED),
                transcriptStatus: TranscriptStatus.DONE,
                transcriptLanguage: lectureLanguage,
                transcript: transcriptToStore,
            };
            const notes = result?.notes ?? result?.notesMarkdown ?? result?.notes_markdown ?? result?.content ?? result?.raw ?? null;
            if (notes) updates.aiNotesMarkdown = String(notes);
            const concepts = result?.key_concepts ?? result?.keyConcepts;
            if (Array.isArray(concepts) && concepts.length) updates.aiKeyConcepts = concepts;
            updates.aiNoteImages = [];

            await this.lectureRepo.update(lectureId, updates);
            if (updates.aiNotesMarkdown) {
                this._enrichAndPersistCoachingNoteImages(updates.aiNotesMarkdown, lectureId, tenantId, lectureLanguage);
            }
            this.logger.log(`YouTube AI notes complete for lecture ${lectureId} (${transcriptToStore.length} chars transcript)`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`YouTube AI processing failed for lecture ${lectureId}: ${msg}`);
            await this.lectureRepo.update(lectureId, {
                status: isNewLecture ? LectureStatus.DRAFT : (current?.status ?? LectureStatus.PUBLISHED),
                transcriptStatus: TranscriptStatus.FAILED,
            });
        }
    }

    private async _processLectureAI(
        lectureId: string,
        videoUrl: string,
        topicId: string | undefined,
        tenantId: string,
    ): Promise<void> {
        // â”€â”€ YouTube branch: fetch captions instead of running Whisper â”€â”€â”€â”€â”€â”€â”€â”€
        if (this.isYouTubeUrl(videoUrl)) {
            const videoId = this.extractYouTubeId(videoUrl);
            if (!videoId) {
                this.logger.error(`Cannot extract YouTube video ID from URL: ${videoUrl}`);
                const cur = await this.lectureRepo.findOne({ where: { id: lectureId }, select: ['id', 'status'] });
                await this.lectureRepo.update(lectureId, {
                    status: cur?.status === LectureStatus.PROCESSING ? LectureStatus.DRAFT : (cur?.status ?? LectureStatus.DRAFT),
                    transcriptStatus: TranscriptStatus.FAILED,
                });
                return;
            }
            return this._processYouTubeLecture(lectureId, videoId, topicId, tenantId);
        }

        // â”€â”€ Direct-media two-phase pipeline (Whisper â†’ save â†’ LLM notes) â”€â”€â”€â”€â”€â”€â”€â”€
        const cleanUrl = this._fixVideoUrl(videoUrl);
        this.logger.log(`AI processing started for lecture ${lectureId} url=${cleanUrl}`);

        const current = await this.lectureRepo.findOne({ where: { id: lectureId }, select: ['id', 'status', 'lectureLanguage'] });
        const lectureLanguage = this.normalizeLectureLanguage(current?.lectureLanguage);
        const aiLanguage = this.getAiProcessingLanguage(lectureLanguage);
        this.logger.log(
            `AI processing language for lecture ${lectureId}: stored=${current?.lectureLanguage ?? 'unset'} normalized=${lectureLanguage} ai=${aiLanguage}`,
        );

        await this.lectureRepo.update(lectureId, { transcriptStatus: TranscriptStatus.PROCESSING });

        // â”€â”€ Phase 1: Whisper transcription (no LLM, ~2-5 min) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let transcriptToStore: string;
        try {
            const transcribeResult = await this.aiBridgeService.transcribeAudio(
                { audioUrl: cleanUrl, language: aiLanguage, topicId: topicId ?? '' },
                tenantId,
            ) as any;

            const rawTranscript: string = transcribeResult?.rawTranscript ?? transcribeResult?.transcript ?? '';
            if (!rawTranscript || rawTranscript.trim().length < 20) {
                throw new Error('Transcription returned empty or too-short transcript');
            }
            transcriptToStore = rawTranscript;

            // Save transcript immediately so it is never lost even if Phase 2 fails
            await this.lectureRepo.update(lectureId, {
                transcriptStatus: TranscriptStatus.DONE,
                transcript: transcriptToStore,
                transcriptLanguage: lectureLanguage,
            });
            this.logger.log(`Phase 1 done: transcript saved (${transcriptToStore.length} chars) for lecture ${lectureId}`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Phase 1 transcription failed for lecture ${lectureId}: ${msg}`);
            await this.lectureRepo.update(lectureId, { transcriptStatus: TranscriptStatus.FAILED });
            return;
        }

        // â”€â”€ Phase 2 (Removed): LLM note generation is now manually triggered via regenerateNotes API â”€â”€
    }

    async retranscribeLecture(id: string, userId: string, userRole: UserRole, tenantId: string): Promise<{ message: string }> {
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);
        if (userRole === UserRole.TEACHER && lecture.teacherId !== userId) {
            throw new ForbiddenException('You can only retranscribe your own lectures');
        }
        if (!(await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing'))) {
            throw new ForbiddenException('AI transcription is not enabled for your institution.');
        }
        if (lecture.type !== LectureType.RECORDED || !lecture.videoUrl) {
            throw new BadRequestException('Only recorded lectures with a video URL can be transcribed');
        }
        if (lecture.transcriptStatus === TranscriptStatus.PROCESSING) {
            return { message: 'Transcription already in progress' };
        }
        await this.lectureRepo.update(id, { transcriptStatus: TranscriptStatus.PROCESSING });
        this._processLectureAI(id, lecture.videoUrl, lecture.topicId, tenantId).catch(() => { });
        return { message: 'Transcription started' };
    }

    async regenerateNotes(id: string, userId: string, userRole: UserRole, tenantId: string): Promise<{ message: string }> {
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);
        if (userRole === UserRole.TEACHER && lecture.teacherId !== userId) {
            throw new ForbiddenException('You can only regenerate notes for your own lectures');
        }
        if (!lecture.transcript || lecture.transcript.trim().length < 20) {
            throw new BadRequestException('No transcript saved — run transcription first');
        }
        const lectureLanguage = this.normalizeLectureLanguage(lecture.lectureLanguage);
        const aiLanguage = this.getAiProcessingLanguage(lectureLanguage);
        await this.lectureRepo.update(id, { aiNotesMarkdown: null as any, aiNoteImages: [] });
        this._runNotesFromSavedTranscript(id, lecture.transcript, lecture.topicId, aiLanguage, tenantId).catch(() => { });
        return { message: 'Notes generation started' };
    }

    async regenerateNoteImage(
        id: string,
        caption: string,
        visualDescription: string,
        evidenceQuote: string | undefined,
        sectionHeading: string | undefined,
        oldImageUrl: string,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<any> {
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);
        if (userRole === UserRole.TEACHER && lecture.teacherId !== userId) {
            throw new ForbiddenException('You can only regenerate notes for your own lectures');
        }
        if (!(await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing'))) {
            throw new ForbiddenException('AI transcription is not enabled for your institution.');
        }

        const searchTerm = [visualDescription, caption].map((value) => value?.trim()).filter(Boolean).join(' ');
        if (!searchTerm) throw new BadRequestException('An image search description is required');
        const sourceUrl = await this._searchNoteImage(
            searchTerm,
            tenantId,
            this.normalizeLectureLanguage(lecture.lectureLanguage),
        );
        if (!sourceUrl) throw new BadRequestException('No suitable image search result was found');
        const searchedImageUrl = await this._storeSearchedNoteImage(
            sourceUrl,
            tenantId,
            id,
            `replacement-${Date.now()}`,
        );
        if (!searchedImageUrl) throw new BadRequestException('The selected image could not be stored');

        let notesMarkdown = lecture.aiNotesMarkdown || '';
        const newMarkdownImg = `![${caption}](${searchedImageUrl})`;

        const escapedOldUrl = oldImageUrl.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const imgRegex = new RegExp(`!\\[[^\\]]*\\]\\(${escapedOldUrl}\\)`, 'g');
        notesMarkdown = notesMarkdown.replace(imgRegex, newMarkdownImg);

        let noteImages = Array.isArray(lecture.aiNoteImages) ? lecture.aiNoteImages : [];
        const newImageObj = {
            url: searchedImageUrl,
            caption,
            section_heading: sectionHeading,
            evidence_quote: evidenceQuote,
            prompt: searchTerm,
            provider: 'serpapi',
            model: 'google-images',
        };

        let replaced = false;
        noteImages = noteImages.map((img: any) => {
            if (img && img.url === oldImageUrl) {
                replaced = true;
                return newImageObj;
            }
            return img;
        });
        if (!replaced) {
            noteImages.push(newImageObj);
        }

        await this.lectureRepo.update(id, {
            aiNotesMarkdown: notesMarkdown,
            aiNoteImages: noteImages,
        });

        return {
            message: 'Replacement image found successfully',
            image: {
                url: searchedImageUrl,
                caption,
                visualDescription,
                overlayLabels: [],
                sectionHeading,
                evidenceQuote,
            },
        };
    }

    async refreshNoteImages(
        id: string,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<{ message: string; imageCount: number }> {
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);
        if (userRole === UserRole.TEACHER && lecture.teacherId !== userId) {
            throw new ForbiddenException('You can only refresh visuals for your own lectures');
        }
        if (!(await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing'))) {
            throw new ForbiddenException('AI lecture notes are not enabled for your institution.');
        }
        if (!lecture.aiNotesMarkdown || lecture.aiNotesMarkdown.trim().length < 20) {
            throw new BadRequestException('No AI notes available yet');
        }

        const cleanNotes = this._stripEmbeddedNoteImages(lecture.aiNotesMarkdown);
        const enriched = await this._enrichCoachingNotesWithImageSearch(
            cleanNotes,
            id,
            tenantId,
            this.normalizeLectureLanguage(lecture.lectureLanguage),
        );
        if (!enriched.images.length) {
            throw new BadRequestException('No suitable educational images were found');
        }
        await this.lectureRepo.update(id, {
            aiNotesMarkdown: enriched.notes,
            aiNoteImages: enriched.images,
        });
        return {
            message: 'Visuals refreshed successfully',
            imageCount: enriched.images.length,
        };
    }

    private async _runNotesFromSavedTranscript(
        lectureId: string,
        transcript: string,
        topicId: string | undefined,
        aiLanguage: 'en' | 'hi' | 'hinglish' | 'hi-in' | 'od',
        tenantId: string,
    ): Promise<void> {
        this.logger.log(`Regenerating notes for lecture ${lectureId} (${transcript.length} chars, language=${aiLanguage})`);
        try {
            const notesResult = await this.aiBridgeService.generateNotesFromTranscript(
                { transcript, topicId: topicId ?? '', language: aiLanguage, skipImageGeneration: true },
                tenantId,
            ) as any;
            const notes = notesResult?.notes ?? notesResult?.notesMarkdown ?? notesResult?.notes_markdown ?? null;
            const concepts = notesResult?.key_concepts ?? notesResult?.keyConcepts;
            const updates: Partial<Lecture> = {};
            if (notes && String(notes).trim() && String(notes).trim() !== '__NOTES_FAILED__') {
                updates.aiNotesMarkdown = String(notes);
            } else {
                throw new Error('AI notes response did not contain usable notes');
            }
            if (Array.isArray(concepts) && concepts.length) updates.aiKeyConcepts = concepts;
            updates.aiNoteImages = [];
            if (Object.keys(updates).length) await this.lectureRepo.update(lectureId, updates);
            if (updates.aiNotesMarkdown) {
                this._enrichAndPersistCoachingNoteImages(updates.aiNotesMarkdown, lectureId, tenantId, aiLanguage);
            }
            this.logger.log(`Notes regenerated for lecture ${lectureId}`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Notes regeneration failed for lecture ${lectureId}: ${msg}`);
            await this.lectureRepo.update(lectureId, { aiNotesMarkdown: '__NOTES_FAILED__' });
        }
    }

    async translateLectureTranscript(
        id: string,
        tenantId: string,
        user?: { id: string; role: UserRole },
    ): Promise<{ transcriptHi: string }> {
        const lecture = await this.lectureRepo.findOne({ where: { id } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);
        if (user?.role === UserRole.STUDENT) {
            await this.assertStudentEnrolledInBatch(user.id, lecture.batchId);
        }

        // Return cached version if already translated
        if (lecture.transcriptHi) return { transcriptHi: lecture.transcriptHi };

        if (!lecture.transcript) throw new BadRequestException('No transcript available to translate');

        if (!(await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing'))) {
            throw new ForbiddenException({
                code: 'FEATURE_NOT_ENABLED',
                feature: 'ai_lecture_processing',
                message: `The feature "ai_lecture_processing" is not enabled for your institution.`,
            });
        }

        // Call AI bridge to translate English â†’ Hindi
        const result = await this.aiBridgeService.translateText(
            { text: lecture.transcript, targetLanguage: 'hi' },
            tenantId,
        ) as any;

        const translated: string = result?.translatedText ?? result?.text ?? result?.translation ?? '';
        if (!translated) throw new BadRequestException('Translation returned empty result');

        await this.lectureRepo.update(id, { transcriptHi: translated });
        return { transcriptHi: translated };
    }

    async translateLectureNotes(
        id: string,
        tenantId: string,
        user?: { id: string; role: UserRole },
        targetLanguage: string = 'en',
    ): Promise<{ translated: string }> {
        const lecture = await this.lectureRepo.findOne({ where: { id } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);
        if (user?.role === UserRole.STUDENT) {
            await this.assertStudentEnrolledInBatch(user.id, lecture.batchId);
        }
        if (!lecture.aiNotesMarkdown) throw new BadRequestException('No AI notes available to translate');

        if (!(await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing'))) {
            throw new ForbiddenException({
                code: 'FEATURE_NOT_ENABLED',
                feature: 'ai_lecture_processing',
                message: `The feature "ai_lecture_processing" is not enabled for your institution.`,
            });
        }

        const result = await this.aiBridgeService.translateText(
            { text: lecture.aiNotesMarkdown, targetLanguage },
            tenantId,
        ) as any;

        const translated: string = result?.translatedText ?? result?.text ?? result?.translation ?? '';
        if (!translated) throw new BadRequestException('Translation returned empty result');

        return { translated };
    }

    /** @deprecated Use translateLectureNotes instead */
    async translateLectureNotesToEnglish(
        id: string,
        tenantId: string,
        user?: { id: string; role: UserRole },
    ): Promise<{ notesEn: string }> {
        const { translated } = await this.translateLectureNotes(id, tenantId, user, 'en');
        return { notesEn: translated };
    }

    /** Student must have an active or completed enrollment in the lecture's batch (course). */
    private async assertStudentEnrolledInBatch(userId: string, batchId: string | null | undefined): Promise<void> {
        if (!batchId) {
            throw new ForbiddenException('This lecture is not linked to a course batch');
        }
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new ForbiddenException('Student profile not found');
        const enrollment = await this.enrollmentRepo.findOne({
            where: {
                studentId: student.id,
                batchId,
                status: In([EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]),
            },
        });
        if (!enrollment) {
            throw new ForbiddenException('You are not enrolled in this course');
        }
    }

    /**
     * Request `tenantId` (from Host / JWT) may not match `lecture.tenant_id` for students
     * (e.g. LAN IP â†’ platform tenant vs institute lecture). Students: load by id only; others: tenant-scoped.
     */
    private async findLectureForRole(
        id: string,
        tenantId: string,
        user: { id?: string; role?: UserRole } | undefined,
        relations?: string[],
    ): Promise<Lecture | null> {
        if (user?.role === UserRole.STUDENT) {
            return this.lectureRepo.findOne({ where: { id }, relations });
        }
        return this.lectureRepo.findOne({ where: { id, tenantId }, relations });
    }

    async getLectures(
        query: LectureQueryDto,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<{ data: Lecture[]; meta: any }> {
        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const qb = this.lectureRepo.createQueryBuilder('l')
            .leftJoinAndSelect('l.topic', 'topic')
            .leftJoinAndSelect('topic.chapter', 'chapter')
            .leftJoinAndSelect('chapter.subject', 'subject');

        if (query.batchId) qb.andWhere('l.batchId = :batchId', { batchId: query.batchId });
        if (query.topicId) qb.andWhere('l.topicId = :topicId', { topicId: query.topicId });
        if (query.chapterId) qb.andWhere('topic.chapterId = :chapterId', { chapterId: query.chapterId });
        if (query.subjectId) qb.andWhere('chapter.subjectId = :subjectId', { subjectId: query.subjectId });
        if (query.status) qb.andWhere('l.status = :status', { status: query.status });

        // Fetch student profile once; reused across all three student-role branches below
        let student: Student | null = null;
        if (userRole === UserRole.STUDENT) {
            student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        }

        // Role-based filtering
        if (userRole === UserRole.STUDENT) {
            // Students see only lectures from their enrolled batches — cross-tenant safe (no tenantId filter)
            if (student) {
                const enrollments = await this.enrollmentRepo.find({
                    where: {
                        studentId: student.id,
                        status: In([EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]),
                    },
                });
                const batchIds = enrollments.map((e) => e.batchId).filter(Boolean);
                if (batchIds.length > 0) {
                    qb.andWhere('l.batchId IN (:...batchIds)', { batchIds });
                } else {
                    return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
                }
                qb.andWhere('l.status IN (:...statuses)', {
                    statuses: [LectureStatus.PUBLISHED, LectureStatus.LIVE, LectureStatus.SCHEDULED, LectureStatus.ENDED],
                });
            } else {
                return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
            }
        } else if (userRole === UserRole.TEACHER) {
            qb.andWhere('l.tenantId = :tenantId', { tenantId })
                .andWhere('l.teacherId = :userId', { userId });
        } else {
            // admin/super_admin scoped to their tenant
            qb.andWhere('l.tenantId = :tenantId', { tenantId });
        }

        qb.orderBy('l.createdAt', 'DESC').skip(skip).take(limit);

        const [data, total] = await qb.getManyAndCount();
        const result: { data: Lecture[]; meta: any; aiStudyStatus?: any; quiz?: any; gateStatus?: any } = {
            data,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };

        // Attach studentProgress to ALL student lecture requests (not just topicId-scoped ones)
        if (userRole === UserRole.STUDENT && data.length > 0) {
            if (student && !query.topicId) {
                const lectureIds = data.map((l) => l.id);
                const progresses = lectureIds.length
                    ? await this.progressRepo.find({ where: { studentId: student.id, lectureId: In(lectureIds) } })
                    : [];
                const progressMap = new Map(progresses.map((p) => [p.lectureId, p]));
                (result as any).data = data.map((lec) => {
                    const lp = progressMap.get(lec.id);
                    return {
                        ...lec,
                        studentProgress: lp
                            ? { watchPercentage: lp.watchPercentage, lastPositionSeconds: lp.lastPositionSeconds, isCompleted: lp.isCompleted, rewindCount: lp.rewindCount }
                            : null,
                    };
                });
            }
        }

        // Attach per-lecture progress, quiz, gate status, AI study status (student + topicId filter)
        if (query.topicId && userRole === UserRole.STUDENT) {
            if (student) {
                const lectureIds = data.map((l) => l.id);

                const [lectureProgresses, aiSession, mockTest, topicProgress, topic] = await Promise.all([
                    lectureIds.length
                        ? this.progressRepo.find({ where: { studentId: student.id, lectureId: In(lectureIds) } })
                        : [],
                    this.aiStudyRepo.findOne({ where: { studentId: student.id, topicId: query.topicId } }),
                    this.mockTestRepo.findOne({
                        where: { topicId: query.topicId, tenantId, isPublished: true },
                        order: { createdAt: 'DESC' },
                    }),
                    this.topicProgressRepo.findOne({ where: { studentId: student.id, topicId: query.topicId } }),
                    this.topicRepo.findOne({ where: { id: query.topicId, tenantId } }),
                ]);

                const progressByLecture = new Map<string, LectureProgress>(
                    lectureProgresses.map((p) => [p.lectureId, p] as [string, LectureProgress]),
                );

                // Attach student progress + sequential lock status to each lecture
                // Rule: first lecture always unlocked; each subsequent locked until previous is completed
                (result as any).data = data.map((lec, idx) => {
                    const lp = progressByLecture.get(lec.id);
                    const isLocked = false;
                    return {
                        ...lec,
                        isLocked,
                        studentProgress: lp
                            ? { watchPercentage: lp.watchPercentage, lastPositionSeconds: lp.lastPositionSeconds, isCompleted: lp.isCompleted, rewindCount: lp.rewindCount }
                            : null,
                    };
                });

                // Quiz info
                result.quiz = mockTest
                    ? {
                        mockTestId: mockTest.id,
                        title: mockTest.title,
                        questionCount: (mockTest.questionIds as string[] | null)?.length ?? 0,
                        durationMinutes: mockTest.durationMinutes,
                        passingMarks: mockTest.passingMarks,
                        isPublished: mockTest.isPublished,
                    }
                    : null;

                // Gate status: canTakeQuiz if any lecture watched > 0 OR AI study completed
                const anyLectureStarted = lectureProgresses.some((p) => p.watchPercentage > 0);
                const aiStudyDone = aiSession?.isCompleted ?? false;
                const canTakeQuiz = anyLectureStarted || aiStudyDone;
                result.gateStatus = {
                    status: topicProgress?.status ?? 'locked',
                    bestAccuracy: topicProgress?.bestAccuracy ?? 0,
                    attemptCount: topicProgress?.attemptCount ?? 0,
                    gatePassPercentage: topic?.gatePassPercentage ?? 70,
                    canTakeQuiz,
                    quizUnlockReason: anyLectureStarted ? 'lecture_watched' : aiStudyDone ? 'ai_study_completed' : 'not_unlocked',
                };

                // AI study status
                result.aiStudyStatus = {
                    hasSession: !!aiSession,
                    sessionId: aiSession?.id ?? null,
                    isCompleted: aiSession?.isCompleted ?? false,
                    lessonMarkdown: aiSession?.lessonMarkdown ?? null,
                };
            }
        }

        return result;
    }

    async getLectureById(id: string, tenantId: string, user?: any): Promise<Lecture> {
        const lecture = await this.findLectureForRole(id, tenantId, user, ['topic', 'batch']);
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);

        // Requirement: Remove access restricted completely
        // if (user?.role === UserRole.STUDENT) {
        //     await this.assertStudentEnrolledInBatch(user.id, lecture.batchId);
        // }



        return lecture;
    }

    async updateLecture(
        id: string,
        dto: UpdateLectureDto,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<Lecture> {
        this.logger.log(`Updating lecture ${id} for tenant ${tenantId}`);
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);

        const isAdmin =
            userRole === UserRole.INSTITUTE_ADMIN || userRole === UserRole.SUPER_ADMIN;

        if (!isAdmin) {
            if (lecture.teacherId !== userId) {
                throw new ForbiddenException('You can only modify your own lectures');
            }
            if (dto.teacherId && dto.teacherId !== lecture.teacherId) {
                throw new ForbiddenException('Teachers cannot change the assigned teacher');
            }
        }

        const wasPublished = lecture.status === LectureStatus.PUBLISHED;
        const incomingVideoUrl = typeof dto.videoUrl === 'string' ? dto.videoUrl.trim() : undefined;
        const videoUrlChanged = !!incomingVideoUrl && incomingVideoUrl !== (lecture.videoUrl ?? '');
        const shouldPromoteToRecorded =
            videoUrlChanged &&
            (dto.type === LectureType.RECORDED ||
                lecture.type === LectureType.LIVE ||
                lecture.status === LectureStatus.ENDED);

        Object.assign(lecture, dto);

        const sttEnabled = videoUrlChanged
            ? await this.tenantAiFeatureService.checkFeature(tenantId, 'ai_lecture_processing')
            : false;

        if (videoUrlChanged && incomingVideoUrl) {
            lecture.videoUrl = this._fixVideoUrl(incomingVideoUrl);
            lecture.transcriptStatus = sttEnabled ? TranscriptStatus.PENDING : (null as any);
            lecture.transcript = null as any;
            lecture.transcriptHi = null as any;
            lecture.aiNotesMarkdown = null as any;
            lecture.aiKeyConcepts = [];
            lecture.aiFormulas = [];
            lecture.aiNoteImages = [];
            lecture.quizCheckpoints = [];
        }

        if (shouldPromoteToRecorded) {
            lecture.type = LectureType.RECORDED;
            lecture.status = dto.status ?? LectureStatus.PUBLISHED;
        }

        const saved = await this.lectureRepo.save(lecture);

        // Fire in-app notifications to all enrolled students when a lecture is first published
        if (!wasPublished && saved.status === LectureStatus.PUBLISHED && saved.batchId) {
            this._notifyStudentsOnPublish(saved).catch(err =>
                this.logger.warn(`Failed to send publish notifications for lecture ${saved.id}: ${err.message}`)
            );
        }

        if (videoUrlChanged && saved.videoUrl && sttEnabled) {
            this._processLectureAI(saved.id, saved.videoUrl, saved.topicId, tenantId).catch(err =>
                this.logger.warn(`Failed to start AI processing for lecture ${saved.id}: ${err instanceof Error ? err.message : String(err)}`),
            );
        }

        return saved;
    }

    private async _notifyStudentsOnPublish(lecture: Lecture): Promise<void> {
        const enrollments = await this.enrollmentRepo.find({
            where: { batchId: lecture.batchId, status: EnrollmentStatus.ACTIVE },
        });
        if (!enrollments.length) return;

        const studentIds = enrollments.map(e => e.studentId);
        const studentRepo = this.dataSource.getRepository(Student);
        const students = await studentRepo.findBy({ id: In(studentIds) });

        for (const student of students) {
            if (!student.userId) continue;
            await this.notificationService.send({
                userId: student.userId,
                tenantId: lecture.tenantId,
                title: 'New Lecture Published',
                body: `"${lecture.title}" is now available. Start watching!`,
                channels: ['in_app'],
                refType: 'lecture_published',
                refId: lecture.id,
            });
        }
    }

    async deleteLecture(
        id: string,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<{ message: string }> {
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);

        const isAdmin =
            userRole === UserRole.INSTITUTE_ADMIN || userRole === UserRole.SUPER_ADMIN;

        if (!isAdmin && lecture.teacherId !== userId) {
            throw new ForbiddenException('You can only delete your own lectures');
        }

        await this.lectureRepo.softDelete(id);
        return { message: 'Lecture deleted successfully' };
    }

    // â”€â”€â”€ LECTURE PROGRESS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async upsertProgress(
        lectureId: string,
        dto: UpsertProgressDto,
        userId: string,
        tenantId: string,
    ): Promise<any> {
        this.logger.log(`Upserting progress for lecture ${lectureId}, user ${userId}`);

        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        await this.assertStudentEnrolledInBatch(userId, lecture.batchId);

        let progress = await this.progressRepo.findOne({
            where: { lectureId, studentId: student.id },
        });

        const wasCompleted = progress?.isCompleted ?? false;

        if (!progress) {
            progress = this.progressRepo.create({
                lectureId,
                studentId: student.id,
                tenantId: lecture.tenantId,
            });
        }

        progress.watchPercentage = dto.watchPercentage;
        progress.lastPositionSeconds = dto.lastPositionSeconds;
        if (dto.rewindCount !== undefined) progress.rewindCount = dto.rewindCount;
        if (dto.confusionFlags !== undefined) progress.confusionFlags = dto.confusionFlags;
        progress.isCompleted = dto.watchPercentage >= 90;

        const saved = await this.progressRepo.save(progress);

        // â”€â”€ Transition TopicProgress UNLOCKED â†’ IN_PROGRESS on first watch â”€â”€â”€
        if (lecture.topicId && dto.watchPercentage > 0) {
            let topicProg = await this.topicProgressRepo.findOne({
                where: { studentId: student.id, topicId: lecture.topicId },
            });
            if (!topicProg) {
                topicProg = this.topicProgressRepo.create({
                    studentId: student.id,
                    topicId: lecture.topicId,
                    tenantId: lecture.tenantId,
                    status: TopicStatus.IN_PROGRESS,
                    unlockedAt: new Date(),
                });
                await this.topicProgressRepo.save(topicProg);
            } else if (topicProg.status === TopicStatus.UNLOCKED || topicProg.status === TopicStatus.LOCKED) {
                topicProg.status = TopicStatus.IN_PROGRESS;
                if (!topicProg.unlockedAt) topicProg.unlockedAt = new Date();
                await this.topicProgressRepo.save(topicProg);
            }
        }

        // â”€â”€ On first completion, award XP + auto-complete plan item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (!wasCompleted && saved.isCompleted && lecture.topicId) {
            const XP_PER_LECTURE = 10;

            // Award XP
            student.xpTotal = (student.xpTotal ?? 0) + XP_PER_LECTURE;
            await this.dataSource.getRepository(Student).save(student);

            // Auto-complete the plan item for this lecture (if any, pending/in-progress)
            const plan = await this.studyPlanRepo.findOne({
                where: { studentId: student.id, tenantId: lecture.tenantId },
                order: { createdAt: 'DESC' },
            });
            if (plan) {
                await this.planItemRepo
                    .createQueryBuilder()
                    .update(PlanItem)
                    .set({ status: PlanItemStatus.COMPLETED, completedAt: new Date() })
                    .where('planId = :planId', { planId: plan.id })
                    .andWhere('refId = :refId', { refId: lectureId })
                    .andWhere('type = :type', { type: PlanItemType.LECTURE })
                    .andWhere('status != :done', { done: PlanItemStatus.COMPLETED })
                    .execute();
            }

            // Auto-complete topic when all its lectures have been watched (90%+)
            const topicLectures = await this.lectureRepo.find({
                where: { topicId: lecture.topicId, tenantId: lecture.tenantId },
                select: ['id'],
            });
            if (topicLectures.length > 0) {
                const completedLectures = await this.progressRepo.count({
                    where: {
                        studentId: student.id,
                        lectureId: In(topicLectures.map(l => l.id)),
                        isCompleted: true,
                    },
                });
                if (completedLectures >= topicLectures.length) {
                    const topicProg = await this.topicProgressRepo.findOne({
                        where: { studentId: student.id, topicId: lecture.topicId },
                    });
                    if (topicProg && topicProg.status !== TopicStatus.COMPLETED) {
                        topicProg.status = TopicStatus.COMPLETED;
                        if (!topicProg.completedAt) topicProg.completedAt = new Date();
                        await this.topicProgressRepo.save(topicProg);
                    }
                }
            }

            // Find quiz (mock test) linked to this topic so the frontend knows it's available
            const quiz = await this.mockTestRepo.findOne({
                where: { topicId: lecture.topicId, tenantId: lecture.tenantId },
                select: ['id', 'topicId', 'questionIds', 'durationMinutes'],
            });

            const completionReward = {
                xpAwarded: XP_PER_LECTURE,
                quizAvailable: !!quiz,
                mockTestId: quiz?.id ?? null,
                topicId: lecture.topicId,
                message: quiz
                    ? `+${XP_PER_LECTURE} XP earned! Topic quiz is now available.`
                    : `+${XP_PER_LECTURE} XP earned! Lecture completed.`,
            };

            this.logger.log(
                `Lecture ${lectureId} completed by student ${student.id}: ${completionReward.message}`,
            );

            return { ...saved, completionReward };
        }

        return saved;
    }

    async getProgress(
        lectureId: string,
        user: { id: string; role: UserRole },
        tenantId: string,
        studentIdOverride?: string,
    ): Promise<LectureProgress | null> {
        const lecture = await this.findLectureForRole(lectureId, tenantId, user);
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        let studentId: string;

        const isAdmin =
            user.role === UserRole.INSTITUTE_ADMIN ||
            user.role === UserRole.SUPER_ADMIN ||
            user.role === UserRole.TEACHER;

        if (isAdmin && studentIdOverride) {
            // Admin viewing a specific student
            studentId = studentIdOverride;
        } else {
            const student = await this.dataSource.getRepository(Student).findOne({ where: { userId: user.id } });
            if (!student) throw new NotFoundException('Student profile not found');
            if (user.role === UserRole.STUDENT) {
                await this.assertStudentEnrolledInBatch(user.id, lecture.batchId);
            }
            studentId = student.id;
        }

        return this.progressRepo.findOne({ where: { lectureId, studentId } });
    }

    async getLectureStats(lectureId: string, tenantId: string) {
        this.logger.log(`Getting stats for lecture ${lectureId}`);
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const allProgress = await this.progressRepo.find({ where: { lectureId } });

        const totalStudents = allProgress.length;
        const watchedCount = allProgress.filter((p) => p.watchPercentage > 0).length;
        const completedCount = allProgress.filter((p) => p.isCompleted).length;
        const avgWatchPercentage =
            totalStudents > 0
                ? allProgress.reduce((sum, p) => sum + p.watchPercentage, 0) / totalStudents
                : 0;

        // Aggregate confusion flags across all students â†’ top 5 hotspots
        const flagMap = new Map<number, number>();
        for (const p of allProgress) {
            if (p.confusionFlags) {
                for (const flag of p.confusionFlags) {
                    flagMap.set(
                        flag.timestampSeconds,
                        (flagMap.get(flag.timestampSeconds) || 0) + flag.rewindCount,
                    );
                }
            }
        }
        const confusionHotspots = Array.from(flagMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([timestampSeconds, totalRewinds]) => ({ timestampSeconds, totalRewinds }));

        return {
            totalStudents,
            watchedCount,
            completedCount,
            avgWatchPercentage: Math.round(avgWatchPercentage * 100) / 100,
            confusionHotspots,
        };
    }

    // â”€â”€ Quiz Checkpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async saveQuizCheckpoints(lectureId: string, questions: any[], userId: string, tenantId: string) {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);
        lecture.quizCheckpoints = questions;
        await this.lectureRepo.save(lecture);
        return { message: 'Quiz saved', count: questions.length };
    }

    async getQuizCheckpoints(lectureId: string, tenantId: string, user?: { id: string; role: UserRole }) {
        const lecture = await this.findLectureForRole(lectureId, tenantId, user);
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);
        if (user?.role === UserRole.STUDENT) {
            await this.assertStudentEnrolledInBatch(user.id, lecture.batchId);
        }
        return lecture.quizCheckpoints ?? [];
    }

    async submitQuizResponse(
        lectureId: string,
        dto: { questionId: string; selectedOption: string; timeTakenSeconds?: number },
        userId: string,
        tenantId: string,
    ) {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const question = (lecture.quizCheckpoints ?? []).find((q) => q.id === dto.questionId);
        if (!question) throw new NotFoundException(`Question ${dto.questionId} not found`);

        const isCorrect = question.correctOption === dto.selectedOption;

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        await this.assertStudentEnrolledInBatch(userId, lecture.batchId);

        let progress = await this.progressRepo.findOne({ where: { lectureId, studentId: student.id } });
        if (!progress) {
            progress = this.progressRepo.create({ lectureId, studentId: student.id, tenantId: lecture.tenantId });
        }

        const existing = (progress.quizResponses ?? []).findIndex((r) => r.questionId === dto.questionId);
        const response = {
            questionId: dto.questionId,
            selectedOption: dto.selectedOption,
            isCorrect,
            answeredAt: new Date().toISOString(),
            timeTakenSeconds: dto.timeTakenSeconds,
        };
        if (existing >= 0) {
            progress.quizResponses[existing] = response;
        } else {
            progress.quizResponses = [...(progress.quizResponses ?? []), response];
        }

        await this.progressRepo.save(progress);
        return { isCorrect, correctOption: question.correctOption, explanation: question.explanation };
    }

    async getWatchAnalytics(lectureId: string, tenantId: string) {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const allProgress = await this.progressRepo.find({
            where: { lectureId },
            relations: ['student'],
        });

        const questions = lecture.quizCheckpoints ?? [];

        // Per-student summary
        const students = allProgress.map((p) => {
            const responses = p.quizResponses ?? [];
            const answered = responses.length;
            const correct = responses.filter((r) => r.isCorrect).length;
            return {
                studentId: p.studentId,
                studentName: (p.student as any)?.fullName ?? 'Unknown',
                watchPercentage: p.watchPercentage,
                isCompleted: p.isCompleted,
                lastPositionSeconds: p.lastPositionSeconds,
                quizScore: answered > 0 ? Math.round((correct / answered) * 100) : null,
                answeredCount: answered,
                correctCount: correct,
                responses,
            };
        });

        // Per-question accuracy
        const questionStats = questions.map((q) => {
            const attempts = allProgress.flatMap((p) =>
                (p.quizResponses ?? []).filter((r) => r.questionId === q.id),
            );
            const correct = attempts.filter((r) => r.isCorrect).length;
            return {
                questionId: q.id,
                questionText: q.questionText,
                segmentTitle: q.segmentTitle,
                totalAttempts: attempts.length,
                correctCount: correct,
                accuracy: attempts.length > 0 ? Math.round((correct / attempts.length) * 100) : null,
            };
        });

        return { students, questionStats, totalWatchers: allProgress.length };
    }

    // â”€â”€â”€ AI STUDY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getStudyStatus(topicId: string, userId: string, tenantId: string) {
        const topic = await this.topicRepo.findOne({ where: { id: topicId } });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const enrollments = await this.enrollmentRepo.find({ where: { studentId: student.id } });
        const batchIds = enrollments.map((e) => e.batchId);

        let lectureCount = 0;
        if (batchIds.length > 0) {
            lectureCount = await this.lectureRepo.count({
                where: { topicId, status: LectureStatus.PUBLISHED, batchId: In(batchIds) },
            });
        }

        const aiSession = await this.aiStudyRepo.findOne({
            where: { studentId: student.id, topicId },
        });

        return {
            topicId,
            topicName: topic.name,
            hasTeacherLecture: lectureCount > 0,
            lectureCount,
            hasAiSession: !!aiSession,
            aiSessionId: aiSession?.id ?? null,
            isAiSessionCompleted: aiSession?.isCompleted ?? false,
            gatePassPercentage: (topic as any).gatePassPercentage ?? 70,
            estimatedStudyMinutes: (topic as any).estimatedStudyMinutes ?? 60,
        };
    }

    async startAiStudy(topicId: string, userId: string, tenantId: string) {
        const topic = await this.topicRepo.findOne({
            where: { id: topicId },
            relations: ['chapter', 'chapter.subject'],
        });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const chapter = (topic as any).chapter;
        const subject = chapter?.subject;

        // Resume existing session (completed or not)
        const existing = await this.aiStudyRepo.findOne({
            where: { studentId: student.id, topicId },
        });
        if (existing && !this.shouldRegenerateLesson(existing.lessonMarkdown)) {
            // Backfill practice questions if missing (e.g., sessions created before this feature)
            if (!existing.practiceQuestions || existing.practiceQuestions.length === 0 || !this.hasStructuredPracticeOptions(existing.practiceQuestions)) {
                try {
                    // Backfill: use exam-tier base count (no keyConcepts yet, use medium complexity)
                    const bfExam = (student.examTarget ?? '').toLowerCase();
                    const bfCount = bfExam.includes('advanced') ? 16 : bfExam.includes('jee') ? 14 : bfExam.includes('neet') ? 12 : 10;
                    const bfDiff = bfExam.includes('advanced') ? 'hard' : bfExam.includes('jee') ? 'medium_hard' : bfExam.includes('neet') ? 'medium' : 'easy_medium';
                    const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                        {
                            topicId,
                            topicName: topic.name,
                            count: bfCount,
                            difficulty: bfDiff,
                            type: 'mcq_single',
                            examTarget: student.examTarget ?? undefined,
                            subject: chapter?.subject?.name || undefined,
                            chapter: chapter?.name || undefined,
                        },
                        tenantId,
                    ) as any[];
                    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
                        existing.practiceQuestions = rawQuestions
                            .map((q: any) => this.mapRawPracticeQuestion(q))
                            .filter((q: any) => q.question);
                        await this.aiStudyRepo.save(existing);
                    }
                } catch (err) {
                    this.logger.warn(`Backfill practice questions failed for session ${existing.id}: ${err.message}`);
                }
            }
            return {
                id: existing.id,
                topicId,
                topicName: topic.name,
                lessonMarkdown: this.normalizeSolvedExamplesFormatting(existing.lessonMarkdown),
                keyConcepts: existing.keyConcepts,
                formulas: existing.formulas,
                practiceQuestions: existing.practiceQuestions,
                commonMistakes: existing.commonMistakes,
                conversation: existing.conversation,
                isCompleted: existing.isCompleted,
                timeSpentSeconds: existing.timeSpentSeconds,
                completedAt: existing.completedAt ?? null,
                highlights: existing.highlights ?? [],
                inlineComments: existing.inlineComments ?? [],
                isNew: false,
            };
        }
        if (existing && this.shouldRegenerateLesson(existing.lessonMarkdown)) {
            this.logger.log(`Regenerating weak/incomplete AI lesson for session ${existing.id}, topic ${topicId}`);
        }

        const examTarget = student.examTarget?.toUpperCase() ?? 'JEE';
        const studentClass = (student as any).class ?? '12';
        const targetCollege = (student as any).targetCollege ?? '';
        const topicName = topic.name;
        const chapterName = chapter?.name ?? '';
        const subjectName = subject?.name ?? '';

        // Derive exam tier label and calibration instructions for the lesson prompt
        const examLower = examTarget.toLowerCase();
        const isAdvanced = examLower.includes('advanced');
        const isJee = examLower.includes('jee');
        const isNeet = examLower.includes('neet');
        const isFoundation = examLower.includes('foundation');

        const tierLabel = isAdvanced ? 'JEE Advanced (IIT — top 0.1%)'
            : isJee ? 'JEE Mains (NIT/IIIT — top 2%)'
                : isNeet ? 'NEET (MBBS — top 1% medical)'
                    : isFoundation ? 'Foundation (Class 8–10)'
                        : examTarget;

        const targetLabel = targetCollege
            ? `${tierLabel} — aiming for ${targetCollege}`
            : tierLabel;

        const tierCalibration = isAdvanced
            ? `- Depth of IIT JEE Advanced: integrate multiple sub-concepts in single examples
- Derivations must be rigorous (starting from first principles)
- Examples must involve multi-step reasoning with non-obvious intermediate steps
- Self-check questions should require concept elimination, not just recall
- Include edge cases, special conditions, and examiner traps`
            : isJee
                ? `- Depth of JEE Mains: strong formula application and numerical fluency
- Cover standard question types (1-mark concept + 4-mark numerical)
- Examples should be 2–3 step reasoning
- Highlight commonly tested approximations and shortcuts`
                : isNeet
                    ? `- Depth of NEET: thorough NCERT alignment with assertion-reason and diagram-based patterns
- Emphasise definitions, classification, exceptions, and factual recall
- Examples should test direct application of NCERT facts and diagrams
- Flag topics with high NEET frequency`
                    : `- Clear, accessible explanations suitable for the student's class
- NCERT-aligned content with simple worked examples
- Focus on concept understanding over calculation complexity`;

        const selfStudyPrompt = `You are a master ${subjectName || 'Science'} teacher who has helped thousands of students crack ${examTarget}. Your lessons are legendary for being crystal-clear, deeply comprehensive, and exam-focused.

Generate a COMPLETE, THOROUGH self-study lesson calibrated precisely for this student's goal. Do not cut corners — depth and clarity are the priority.

TARGET: ${targetLabel}
CALIBRATION REQUIREMENTS:
${tierCalibration}

Topic: ${topicName}
Chapter: ${chapterName}
Subject: ${subjectName}
Exam Target: ${examTarget}
Class: ${studentClass}

---

Write the lesson using this EXACT structure. Each section must be detailed — not a placeholder.

# ${topicName}

## 🎯 What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters for ${examTarget}, and what real-world phenomena it explains. Make it engaging.

## 📖 Introduction & Background
Give the conceptual foundation. Explain the "big picture" — where this topic fits in ${subjectName}, what prior knowledge it builds on, and the intuition behind it. Use analogies to make abstract ideas concrete. Minimum 150 words.

## 🔑 Core Concepts (Explained in Depth)
For EACH major concept in this topic:
### Concept Name
- Clear definition
- Physical/chemical/mathematical meaning
- Intuitive explanation with a relatable analogy or real-world example
- What happens as variables change (if applicable)
- A short illustrative example

Cover ALL concepts — do not skip any.

## 📐 Formulas & Equations
For EVERY formula:
### Formula Name
$$formula$$
- Variables: define each symbol
- Units: state SI units for each
- Conditions: when it applies / assumptions
- How to remember it (mnemonic or pattern)

## 📊 Derivations
For the most important formula(s):
### Derivation of [Formula Name]
Step-by-step derivation with:
- Starting point (fundamental laws/principles)
- Each algebraic step clearly numbered
- Physical meaning of each step
- Final result with units check

## 💡 Solved Examples
### Example 1 — Basic (Concept check)
[Full problem statement]

**Solution:**
Step 1: ...
Step 2: ...

**Answer:** ...

**Key takeaway:** ...

### Example 2 — Intermediate
[Full problem with 2-3 steps]

**Solution:** (detailed)

### Example 3 — ${examTarget} Level (Hard)
[A tricky exam-style question]

**Solution:** (complete step-by-step)

**Examiner's Trap:** explain the trick/trap they set

## 🧠 Connections to Other Topics
- How this topic links to [related topic 1]
- How it connects to [related topic 2]
- Topics that depend on understanding this one

## âš ï¸ Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## 🏆 ${examTarget} Exam Strategy
- How this topic typically appears in ${examTarget} (question types, weightage)
- Which formulas are most tested
- Speed tricks and shortcuts for calculations
- 2-3 previous year question patterns (describe the pattern, not actual PYQs)

## 📝 Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize. These should be the things a student checks 10 minutes before the exam.

## 🔁 Self-Check Questions
5 questions the student should be able to answer after reading this lesson (no answers — just the questions to test themselves):
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete content about ${topicName}.`;

        let lessonMarkdown = '';
        let aiSessionRef: string | null = null;
        let keyConcepts: string[] = [];
        let formulas: string[] = [];
        let commonMistakes: string[] = [];
        let practiceQuestions: Array<{ question: string; answer: string; explanation: string; options?: string[] }> = [];

        try {
            const lessonResponse = await this.aiBridgeService.startTutorSession(
                { studentId: student.id, topicId, context: selfStudyPrompt },
                tenantId,
                'coaching',
            ) as any;

            lessonMarkdown = this.normalizeSolvedExamplesFormatting(this.extractAiText(lessonResponse));
            aiSessionRef = this.extractAiSessionRef(lessonResponse);
            keyConcepts = this.extractBulletSection(lessonMarkdown, 'Core Concepts');
            formulas = this.extractBulletSection(lessonMarkdown, 'Key Formulas');
            if (!formulas.length) {
                formulas = this.extractFormulaCandidates(lessonMarkdown);
            }
            commonMistakes = this.extractBulletSection(lessonMarkdown, 'Common Mistakes Students Make');
        } catch (err) {
            this.logger.warn(`AI lesson generation failed for topic ${topicId}: ${err.message}`);
            // Preserve existing real content if available — never overwrite good data with an error string
            if (existing?.lessonMarkdown && !this.shouldRegenerateLesson(existing.lessonMarkdown)) {
                lessonMarkdown = this.normalizeSolvedExamplesFormatting(existing.lessonMarkdown);
                keyConcepts = existing.keyConcepts ?? [];
                formulas = existing.formulas ?? [];
                commonMistakes = existing.commonMistakes ?? [];
                aiSessionRef = existing.aiSessionRef ?? null;
            } else {
                // No real content exists — return a transient error without saving to DB
                return {
                    id: existing?.id ?? null,
                    topicId,
                    topicName: topic.name,
                    lessonMarkdown: 'AI lesson generation is temporarily unavailable. Please try again in a moment.',
                    keyConcepts: [],
                    formulas: [],
                    practiceQuestions: [],
                    commonMistakes: [],
                    conversation: [],
                    isCompleted: false,
                    timeSpentSeconds: 0,
                    completedAt: null,
                    isNew: false,
                };
            }
        }

        // Dynamic question count: complexity (key-concept count) × exam-tier
        const complexity = keyConcepts.length >= 7 ? 'high' : keyConcepts.length >= 4 ? 'medium' : 'low';
        const qTable: Record<string, Record<string, number>> = {
            advanced: { low: 12, medium: 16, high: 20 },
            jee: { low: 10, medium: 14, high: 18 },
            neet: { low: 8, medium: 12, high: 15 },
            foundation: { low: 5, medium: 8, high: 10 },
            default: { low: 8, medium: 10, high: 12 },
        };
        const qTier = isAdvanced ? 'advanced' : isJee ? 'jee' : isNeet ? 'neet' : isFoundation ? 'foundation' : 'default';
        const questionCount = qTable[qTier][complexity];

        // Difficulty string aligned to exam tier (Django reads this alongside exam_target)
        const qDifficulty = isAdvanced ? 'hard' : isJee ? 'medium_hard' : isNeet ? 'medium' : 'easy_medium';

        // Second call: practice questions via dedicated question-generation endpoint
        try {
            const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                {
                    topicId,
                    topicName: topic.name,
                    count: questionCount,
                    difficulty: qDifficulty,
                    type: 'mcq_single',
                    examTarget: student.examTarget ?? undefined,
                    subject: subjectName || undefined,
                    chapter: chapterName || undefined,
                },
                tenantId,
            ) as any[];

            if (Array.isArray(rawQuestions)) {
                practiceQuestions = rawQuestions
                    .map((q: any) => this.mapRawPracticeQuestion(q))
                    .filter((q: any) => q.question);
            }
        } catch (err) {
            this.logger.warn(`Practice question generation failed for topic ${topicId}: ${err.message}`);
        }

        const introMessage = lessonMarkdown.split('\n').find((l) => l.trim() && !l.startsWith('#'))
            ?? `Here is your AI-generated lesson on ${topicName}.`;

        const session = existing
            ? {
                ...existing,
                lessonMarkdown,
                keyConcepts,
                formulas,
                practiceQuestions,
                commonMistakes,
                aiSessionRef,
                conversation: [{ role: 'ai', message: introMessage, timestamp: new Date().toISOString() }],
                isCompleted: false,
                completedAt: null,
                timeSpentSeconds: 0,
            }
            : this.aiStudyRepo.create({
                tenantId,
                studentId: student.id,
                topicId,
                lessonMarkdown,
                keyConcepts,
                formulas,
                practiceQuestions,
                commonMistakes,
                aiSessionRef,
                conversation: [{ role: 'ai', message: introMessage, timestamp: new Date().toISOString() }],
            });

        const saved = await this.aiStudyRepo.save(session as any);

        return {
            id: saved.id,
            topicId,
            topicName: topic.name,
            lessonMarkdown: this.normalizeSolvedExamplesFormatting(saved.lessonMarkdown),
            keyConcepts: saved.keyConcepts,
            formulas: saved.formulas,
            practiceQuestions: saved.practiceQuestions,
            commonMistakes: saved.commonMistakes,
            conversation: saved.conversation,
            isCompleted: saved.isCompleted,
            timeSpentSeconds: saved.timeSpentSeconds,
            completedAt: saved.completedAt ?? null,
            highlights: saved.highlights ?? [],
            inlineComments: saved.inlineComments ?? [],
            isNew: true,
        };
    }

    async askAiQuestion(
        topicId: string,
        sessionId: string,
        dto: AskAiQuestionDto,
        userId: string,
        tenantId: string,
    ) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const session = await this.aiStudyRepo.findOne({
            where: { id: sessionId, studentId: student.id, topicId },
        });
        if (!session) throw new NotFoundException('AI study session not found');

        let aiResponse = '';
        try {
            const lessonContext = this.buildLessonContextForPrompt(session.lessonMarkdown);
            const contextualQuestion = lessonContext
                ? `Topic: ${topicId}\nUse the existing lesson context below to answer precisely.\n${lessonContext}\n\nStudent question: ${dto.question}`
                : dto.question;
            const response = await this.aiBridgeService.continueTutorSession(
                { sessionId: session.aiSessionRef ?? sessionId, studentMessage: contextualQuestion },
                tenantId,
                'coaching',
            ) as any;
            aiResponse = this.extractAiText(response);
        } catch (err) {
            this.logger.warn(`AI follow-up failed for session ${sessionId}: ${err.message}`);
            aiResponse = 'I could not process your question right now. Please try again.';
        }

        const now = new Date().toISOString();
        const newMessages = [
            { role: 'student' as const, message: dto.question, timestamp: now },
            { role: 'ai' as const, message: aiResponse, timestamp: now },
        ];

        // Keep max 50 messages: always preserve the first (lesson intro) + last 49
        const firstMessage = session.conversation[0];
        let updated = [...session.conversation, ...newMessages];
        if (updated.length > 50) {
            updated = [firstMessage, ...updated.slice(-49)];
        }
        session.conversation = updated;
        await this.aiStudyRepo.save(session);

        return {
            sessionId: session.id,
            studentQuestion: dto.question,
            aiResponse,
            timestamp: now,
            conversation: session.conversation,
        };
    }

    async completeAiStudy(
        topicId: string,
        sessionId: string,
        dto: CompleteAiStudyDto,
        userId: string,
        tenantId: string,
    ) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const session = await this.aiStudyRepo.findOne({
            where: { id: sessionId, studentId: student.id, topicId },
        });
        if (!session) throw new NotFoundException('AI study session not found');

        const now = new Date();
        session.isCompleted = true;
        session.completedAt = now;
        session.timeSpentSeconds = dto.timeSpentSeconds;
        session.highlights = dto.highlights;
        session.inlineComments = dto.inlineComments;
        await this.aiStudyRepo.save(session);

        // Upsert TopicProgress — unlock topic for quiz
        let progress = await this.topicProgressRepo.findOne({
            where: { studentId: student.id, topicId },
        });
        if (!progress) {
            progress = this.topicProgressRepo.create({
                tenantId,
                studentId: student.id,
                topicId,
                status: TopicStatus.UNLOCKED,
                studiedWithAi: true,
                unlockedAt: now,
            });
        } else {
            progress.studiedWithAi = true;
            if (progress.status === TopicStatus.LOCKED) {
                progress.status = TopicStatus.UNLOCKED;
                progress.unlockedAt = now;
            }
        }
        await this.topicProgressRepo.save(progress);

        // Award +10 XP
        const XP_AWARD = 10;
        await this.dataSource.getRepository(Student).increment({ id: student.id }, 'xpTotal', XP_AWARD);
        const updated = await this.dataSource.getRepository(Student).findOne({ where: { id: student.id } });

        // Check if a quiz (mock test) is available for this topic
        const mockTest = await this.dataSource.getRepository(MockTest).findOne({
            where: { tenantId, topicId, isPublished: true } as any,
        });

        const topic = await this.topicRepo.findOne({ where: { id: topicId } });

        return {
            sessionId: session.id,
            isCompleted: true,
            xpAwarded: XP_AWARD,
            xpEarned: XP_AWARD,
            totalXp: updated?.xpTotal ?? 0,
            quizAvailable: !!mockTest,
            mockTestId: mockTest?.id ?? null,
            message: `Great work! You've studied ${topic?.name ?? 'the topic'}. Ready to test yourself?`,
        };
    }

    async saveAiStudyNotes(
        topicId: string,
        sessionId: string,
        dto: UpdateAiStudyNotesDto,
        userId: string,
        tenantId: string,
    ) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const session = await this.aiStudyRepo.findOne({
            where: { id: sessionId, studentId: student.id, topicId },
        });
        if (!session) throw new NotFoundException('AI study session not found');

        session.highlights = dto.highlights;
        session.inlineComments = dto.inlineComments;
        await this.aiStudyRepo.save(session);
        return { success: true };
    }

    async getAiStudySession(topicId: string, userId: string, tenantId?: string) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) return null;

        const session = await this.aiStudyRepo.findOne({
            where: { studentId: student.id, topicId },
        });
        if (!session) return null;

        // If the stored lesson is weak/broken, regenerate it now
        if (tenantId && this.shouldRegenerateLesson(session.lessonMarkdown)) {
            try {
                return await this.startAiStudy(topicId, userId, tenantId);
            } catch (err) {
                this.logger.warn(`Auto-regeneration failed for session ${session.id}: ${err.message}`);
            }
        }

        // Backfill practice questions if missing
        if ((!session.practiceQuestions || session.practiceQuestions.length === 0 || !this.hasStructuredPracticeOptions(session.practiceQuestions)) && tenantId) {
            try {
                const topic = await this.topicRepo.findOne({ where: { id: topicId } });
                if (topic) {
                    const bf3Exam = (student.examTarget ?? '').toLowerCase();
                    const bf3Count = bf3Exam.includes('advanced') ? 16 : bf3Exam.includes('jee') ? 14 : bf3Exam.includes('neet') ? 12 : 10;
                    const bf3Diff = bf3Exam.includes('advanced') ? 'hard' : bf3Exam.includes('jee') ? 'medium_hard' : bf3Exam.includes('neet') ? 'medium' : 'easy_medium';
                    const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                        {
                            topicId,
                            topicName: topic.name,
                            count: bf3Count,
                            difficulty: bf3Diff,
                            type: 'mcq_single',
                            examTarget: student.examTarget ?? undefined,
                        },
                        tenantId,
                    ) as any[];
                    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
                        session.practiceQuestions = rawQuestions
                            .map((q: any) => this.mapRawPracticeQuestion(q))
                            .filter((q: any) => q.question);
                        await this.aiStudyRepo.save(session);
                    }
                }
            } catch (err) {
                this.logger.warn(`Backfill practice questions failed for session ${session.id}: ${err.message}`);
            }
        }

        // Backfill formulas for older sessions where extraction failed earlier
        if ((!session.formulas || session.formulas.length === 0) && session.lessonMarkdown) {
            const extracted =
                this.extractBulletSection(session.lessonMarkdown, 'Key Formulas').length
                    ? this.extractBulletSection(session.lessonMarkdown, 'Key Formulas')
                    : this.extractFormulaCandidates(session.lessonMarkdown);
            if (extracted.length) {
                session.formulas = extracted;
                await this.aiStudyRepo.save(session);
            }
        }

        return {
            id: session.id,
            topicId,
            lessonMarkdown: this.normalizeSolvedExamplesFormatting(session.lessonMarkdown),
            keyConcepts: session.keyConcepts,
            formulas: session.formulas,
            practiceQuestions: session.practiceQuestions,
            commonMistakes: session.commonMistakes,
            conversation: session.conversation,
            isCompleted: session.isCompleted,
            timeSpentSeconds: session.timeSpentSeconds,
            completedAt: session.completedAt ?? null,
            highlights: session.highlights ?? [],
            inlineComments: session.inlineComments ?? [],
        };
    }

    // â”€â”€â”€ AI helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private extractAiText(response: any): string {
        if (!response) return '';
        if (typeof response === 'string') return response;
        const candidate =
            response.response
            ?? response.message
            ?? response.data?.response
            ?? response.data?.message
            ?? response.text
            ?? '';

        // AI can return nested JSON or JSON-like strings; always unwrap to readable text.
        const unwrap = (v: any): string => {
            if (!v) return '';
            if (typeof v === 'string') {
                const trimmed = v.trim();
                if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                    try {
                        return unwrap(JSON.parse(trimmed));
                    } catch {
                        return v;
                    }
                }
                return v;
            }
            if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) {
                // Model sometimes returns only a JSON array of "concept" chips — make readable
                return v.map((s) => String(s).trim()).filter(Boolean).join(' ');
            }
            if (typeof v === 'object' && v !== null) {
                const r =
                    (typeof v.response === 'string' && v.response.trim() ? v.response : '') ||
                    (typeof v.answer === 'string' && v.answer.trim() ? v.answer : '') ||
                    (typeof v.message === 'string' && v.message.trim() ? v.message : '');
                if (r) return r;
                if (Array.isArray(v.hints) && v.hints.length) {
                    // Model may stuff the "answer" only in hints when response is left empty
                    const lines = v.hints.map((h: any) => String(h).trim()).filter(Boolean);
                    return lines.join(' ');
                }
                return JSON.stringify(v);
            }
            return String(v);
        };

        return unwrap(candidate);
    }

    private mapRawPracticeQuestion(q: any): { question: string; answer: string; explanation: string; options?: string[] } {
        const rawOptions = Array.isArray(q?.options) ? q.options : [];
        const options = rawOptions
            .map((o: any) => String(o?.content ?? o?.text ?? '').trim())
            .filter((v: string) => Boolean(v));
        const correctOption = rawOptions.find((o: any) => o?.isCorrect);
        const fallbackAnswer = String(q?.answer ?? '').trim();
        return {
            question: String(q?.content ?? q?.question ?? '').trim(),
            answer: String(correctOption?.content ?? fallbackAnswer).trim(),
            explanation: String(q?.explanation ?? '').trim(),
            options: options.length ? options : undefined,
        };
    }

    private hasStructuredPracticeOptions(
        questions: Array<{ question: string; answer: string; explanation: string; options?: string[] }> | null | undefined,
    ): boolean {
        if (!Array.isArray(questions) || questions.length === 0) return false;
        return questions.some((q) => Array.isArray(q?.options) && q.options.length >= 2);
    }

    private extractAiSessionRef(response: any): string | null {
        if (!response || typeof response !== 'object') return null;
        return response.sessionId ?? response.session_id ?? response.id ?? null;
    }

    private normalizeSolvedExamplesFormatting(markdown: string | null | undefined): string {
        const text = String(markdown || '');
        if (!text) return text;
        return text
            .replace(/([^\n])\s*\*\*Solution:\*\*/g, '$1\n\n**Solution:**')
            .replace(/([^\n])\s*\*\*Answer:\*\*/g, '$1\n\n**Answer:**')
            .replace(/([^\n])\s*\*\*Key takeaway:\*\*/gi, '$1\n\n**Key takeaway:**')
            .replace(/([^\n])\s*\*\*Examiner's Trap:\*\*/gi, '$1\n\n**Examiner\'s Trap:**');
    }

    private extractBulletSection(markdown: string, header: string): string[] {
        const regex = new RegExp(`#{2,4}\\s+[^\\n]*${header}[^\\n]*([^#]*)`, 'i');
        const match = markdown.match(regex);
        if (!match) return [];
        return match[1]
            .split('\n')
            .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
            .filter((l) => l.length > 3 && !l.startsWith('['));
    }

    private buildLessonContextForPrompt(markdown: string | null | undefined): string {
        if (!markdown) return '';
        const plain = markdown
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/[#>*_`~-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return plain.slice(0, 1200);
    }

    private shouldRegenerateLesson(markdown: string | null | undefined): boolean {
        const text = String(markdown || '');
        if (!text.trim()) return true;
        // Too short for a "complete" lesson.
        if (text.length < 4500) return true;
        // Missing key structural sections indicates truncated output.
        const required = ['Core Concepts', 'Formulas', 'Derivation', 'Solved Examples', 'Exam Strategy'];
        const missingCount = required.filter((k) => !new RegExp(k, 'i').test(text)).length;
        if (missingCount >= 1) return true;
        // Truncated-looking formulas/derivations (e.g. "$U =" with no RHS).
        if (/\$[^$\n]{0,25}=\s*(?:\n|$)/m.test(text)) return true;
        if (/Derivation[\s\S]{0,120}:\s*(?:\n|$)/i.test(text)) return true;
        if (/[=:]\s*$/.test(text.trim())) return true;
        return false;
    }

    private extractFormulaCandidates(markdown: string): string[] {
        const lines = String(markdown || '')
            .split('\n')
            .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
            .filter(Boolean);
        const candidates = lines.filter((l) =>
            /[=âˆ‘âˆšÎ”Ï€]/.test(l) ||
            /\b(sin|cos|tan|log|ln|velocity|acceleration|force|energy|mole|concentration|probability)\b/i.test(l),
        );
        const unique = Array.from(new Set(candidates.map((c) => c.replace(/\s+/g, ' ').trim())));
        return unique.slice(0, 10);
    }


    // â”€â”€â”€ AI Quiz â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async generateAiQuiz(topicId: string, userId: string, tenantId: string) {
        const topic = await this.topicRepo.findOne({ where: { id: topicId }, relations: ['chapter', 'chapter.subject'] });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const quizStudent = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        const quizExam = (quizStudent?.examTarget ?? '').toLowerCase();
        const quizCount = quizExam.includes('advanced') ? 12 : quizExam.includes('jee') ? 10 : quizExam.includes('neet') ? 8 : 8;
        const quizDiff = quizExam.includes('advanced') ? 'hard' : quizExam.includes('jee') ? 'medium_hard' : quizExam.includes('neet') ? 'medium' : 'easy_medium';

        let rawQuestions: any[] = [];
        try {
            rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                {
                    topicId,
                    topicName: topic.name,
                    count: quizCount,
                    difficulty: quizDiff,
                    type: 'mcq_single',
                    examTarget: quizStudent?.examTarget ?? undefined,
                    subject: (topic as any).chapter?.subject?.name || undefined,
                    chapter: (topic as any).chapter?.name || undefined,
                },
                tenantId,
            ) as any[];
        } catch (err) {
            this.logger.warn(`AI quiz generation failed for topic ${topicId}: ${err.message}`);
            throw new BadRequestException('AI quiz generation is temporarily unavailable. Please try again.');
        }

        if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
            throw new BadRequestException('AI could not generate questions. Please try again.');
        }

        const difficulties = ['easy', 'easy', 'medium', 'medium', 'hard'];
        const formatted = rawQuestions.slice(0, 10).map((q: any, qi: number) => ({
            id: `ai-${topicId.slice(0, 8)}-${qi}`,
            content: q.content ?? q.question ?? '',
            type: 'mcq_single',
            difficulty: q.difficulty ?? difficulties[qi] ?? 'medium',
            marksCorrect: 4,
            marksWrong: 1,
            explanation: q.explanation ?? '',
            options: (q.options ?? []).map((opt: any, oi: number) => ({
                id: `ai-${topicId.slice(0, 8)}-${qi}-${oi}`,
                optionLabel: opt.label ?? String.fromCharCode(65 + oi),
                content: opt.content ?? String(opt),
                isCorrect: !!opt.isCorrect,
            })),
        }));

        return {
            topicId,
            topicName: topic.name,
            durationMinutes: 15,
            totalMarks: formatted.length * 4,
            passingMarks: Math.ceil(formatted.length * 4 * 0.7),
            questions: formatted,
        };
    }

    // â”€â”€â”€ TOPIC RESOURCES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async createTopicResource(
        topicId: string,
        data: {
            uploadedBy: string;
            type: ResourceType;
            title: string;
            fileUrl?: string | null;
            fileKey?: string | null;
            externalUrl?: string | null;
            fileSizeKb?: number;
            description?: string;
            sortOrder?: number;
        },
        tenantId: string,
    ): Promise<TopicResource> {
        const topic = await this.topicRepo.findOne({ where: { id: topicId, tenantId } });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const resource = this.topicResourceRepo.create({
            tenantId,
            topicId,
            ...data,
            fileUrl: data.fileUrl ?? null,
            externalUrl: data.externalUrl ?? null,
        });
        const saved = await this.topicResourceRepo.save(resource);
        await this.mirrorTopicResourceToStudyMaterial(topicId, tenantId, data);
        this.notifyBatchStudentsOfNewResource(topic, data.title, tenantId).catch((err) => {
            this.logger.warn(`Failed to send resource notification: ${err.message}`);
        });
        return saved;
    }

    async createTopicResourceByUrl(
        topicId: string,
        data: {
            uploadedBy: string;
            type: ResourceType;
            title: string;
            externalUrl: string;
            description?: string;
            sortOrder?: number;
        },
        tenantId: string,
    ): Promise<TopicResource> {
        if (!data.externalUrl?.trim()) throw new BadRequestException('externalUrl is required');
        const topic = await this.topicRepo.findOne({ where: { id: topicId, tenantId } });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const resource = this.topicResourceRepo.create({
            tenantId,
            topicId,
            fileUrl: null,
            ...data,
        });
        const saved = await this.topicResourceRepo.save(resource);
        this.notifyBatchStudentsOfNewResource(topic, data.title, tenantId).catch((err) => {
            this.logger.warn(`Failed to send resource notification: ${err.message}`);
        });
        return saved;
    }

    async getTopicResources(topicId: string, tenantId: string): Promise<TopicResource[]> {
        const topic = await this.topicRepo.findOne({ where: { id: topicId, tenantId } });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        return this.topicResourceRepo.find({
            where: { topicId, tenantId, isActive: true },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
    }

    async updateTopicResource(
        resourceId: string,
        data: Partial<Pick<TopicResource, 'title' | 'description' | 'sortOrder' | 'isActive'>>,
        tenantId: string,
    ): Promise<TopicResource> {
        const resource = await this.topicResourceRepo.findOne({ where: { id: resourceId, tenantId } });
        if (!resource) throw new NotFoundException(`Resource ${resourceId} not found`);

        Object.assign(resource, data);
        return this.topicResourceRepo.save(resource);
    }

    async deleteTopicResource(resourceId: string, tenantId: string): Promise<{ message: string }> {
        const resource = await this.topicResourceRepo.findOne({ where: { id: resourceId, tenantId } });
        if (!resource) throw new NotFoundException(`Resource ${resourceId} not found`);

        await this.topicResourceRepo.softDelete(resourceId);
        return { message: 'Resource deleted successfully' };
    }

    async updateBatchThumbnail(batchId: string, thumbnailUrl: string, tenantId: string): Promise<{ thumbnailUrl: string }> {
        const batch = await this.batchRepo.findOne({ where: { id: batchId, tenantId } });
        if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

        batch.thumbnailUrl = thumbnailUrl;
        await this.batchRepo.save(batch);
        return { thumbnailUrl };
    }

    async completeAiQuiz(
        topicId: string,
        dto: CompleteAiQuizDto,
        userId: string,
        tenantId: string,
    ) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const passed = dto.accuracy >= 70;
        const now = new Date();

        let progress = await this.topicProgressRepo.findOne({
            where: { studentId: student.id, topicId },
        });

        if (!progress) {
            progress = this.topicProgressRepo.create({
                tenantId,
                studentId: student.id,
                topicId,
                status: passed ? TopicStatus.COMPLETED : TopicStatus.IN_PROGRESS,
                bestAccuracy: dto.accuracy,
                ...(passed ? { completedAt: now } : {}),
            });
        } else {
            if (passed) {
                progress.status = TopicStatus.COMPLETED;
                if (!progress.completedAt) progress.completedAt = now;
            } else if (progress.status === TopicStatus.LOCKED || progress.status === TopicStatus.UNLOCKED) {
                progress.status = TopicStatus.IN_PROGRESS;
            }
            if (dto.accuracy > (progress.bestAccuracy ?? 0)) {
                progress.bestAccuracy = dto.accuracy;
            }
        }
        await this.topicProgressRepo.save(progress);

        // Award XP on quiz completion (higher reward when passed).
        const xpEarned = passed ? 15 : 8;
        if (xpEarned > 0) {
            await this.dataSource.getRepository(Student).increment({ id: student.id }, 'xpTotal', xpEarned);
        }

        // If this topic exists as a practice plan item, auto-complete it.
        await this.studyPlanService
            .completeByReference(student.id, tenantId, topicId, PlanItemType.PRACTICE)
            .catch(() => { });

        return {
            passed,
            accuracy: dto.accuracy,
            score: dto.score,
            totalMarks: dto.totalMarks,
            xpEarned,
            message: passed
                ? `Excellent! You passed with ${dto.accuracy.toFixed(0)}% accuracy. Next topic unlocked!`
                : `You scored ${dto.accuracy.toFixed(0)}%. Need 70%+ to pass. Keep practising!`,
        };
    }

    async getTopicResourceByTopicId(resourceId: string, topicId: string): Promise<any> {
        let resource: any = await this.topicResourceRepo.findOne({ where: { id: resourceId, topicId } });
        
        if (!resource) {
            // Check coaching DB's mirrored study materials
            let studyMaterial = await this.studyMaterialRepo.findOne({
                where: { id: resourceId, topicId }
            });
            
            // If not found, check school DB's native study materials
            if (!studyMaterial) {
                const schoolRows = await this.schoolDataSource.query(
                    `SELECT id, title, description, s3_key AS "s3Key" FROM study_materials WHERE id = $1 AND topic_id = $2`,
                    [resourceId, topicId]
                );
                if (schoolRows.length > 0) studyMaterial = schoolRows[0];
            }
            
            if (studyMaterial) {
                let fileUrl = studyMaterial.s3Key;
                if (fileUrl && !fileUrl.startsWith('http')) {
                    fileUrl = this.s3Service.toPublicUrl(fileUrl);
                }
                
                resource = {
                    id: studyMaterial.id,
                    title: studyMaterial.title,
                    description: studyMaterial.description,
                    fileUrl,
                    externalUrl: null, // study_materials are exclusively files/S3 keys
                };
            }
        }

        if (!resource) throw new NotFoundException(`Resource ${resourceId} not found`);
        return resource;
    }

    async generateTopicAiContent(
        topicId: string,
        dto: { contentType: string; difficulty: string; length: string; batchId?: string; examTarget?: string; courseName?: string; extraContext?: string; questionCount?: number },
        tenantId: string,
    ): Promise<{ content: string; contentType: string }> {
        const topic = await this.topicRepo.findOne({
            where: { id: topicId, tenantId },
            relations: ['chapter', 'chapter.subject'],
        });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const subject = (topic as any).chapter?.subject as Subject | undefined;
        const requestedBatchId = dto.batchId || subject?.batchId;
        const batch = requestedBatchId
            ? await this.batchRepo.findOne({ where: { id: requestedBatchId, tenantId } })
            : null;
        const resolvedExamTarget = this.resolveCourseExamTarget(
            batch?.examTarget ?? dto.examTarget ?? subject?.examTarget,
        );
        const resolvedCourseName = batch?.name || dto.courseName || resolvedExamTarget;
        const contentType = String(dto.contentType || 'notes').trim().toLowerCase();
        const isQuestionType = contentType === 'dpp' || contentType === 'pyq';
        const typeSpecificInstruction =
            contentType === 'faq'
                ? 'Generate a Frequently Asked Questions (FAQ) sheet only. Do not write notes, summary, study guide, or lesson sections. FAQ means questions that are repeatedly asked in target exams. For every question, you must specify the actual past exam years it was asked (e.g., JEE Main 2019, 2022). Format each question as: "**Q1. [EXAMTAG: <exam target and comma-separated years>] <question?>**" on its own line, followed by "**A.** <answer>" on a new line. Include 12-15 real student questions grouped under sub-topic headings. For numerical questions, the answer must provide a detailed step-by-step solution where each new step is on a new line (never in paragraph format). For theory questions, the answer must provide a total, complete solution explaining the concept. Do not just give the final answer; provide the full, comprehensive explanation. CRITICAL MATH NOTATION: For all mathematics, equations, exponents, and variables, always use valid KaTeX/LaTeX Markdown. Exponents must use carets (e.g., $x^2$, $x^3$), and all mathematical expressions must be wrapped in single dollar signs (e.g. $3\\sqrt{5}$, $f(3) = 0$). Never output raw math or variables without dollar signs, and never use raw exponents like x2 or x3. For all mathematics in FAQ, use valid KaTeX Markdown: wrap inline expressions in single dollar signs, e.g. $x = \\frac{6}{3 + \\sqrt{2}}$.'
                : contentType === 'checklist' || contentType === 'revision_checklist'
                    ? 'Generate a revision checklist only. Do not write notes or paragraphs. Group by sub-topic and make every actionable item a Markdown checkbox using - [ ].'
                    : contentType === 'flashcard'
                        ? 'Generate flashcards only. Use repeated **Q:** and **A:** pairs. Do not write normal notes.'
                        : contentType === 'dpp'
                            ? `Generate a ${resolvedExamTarget} Daily Practice Problem sheet first. Put all detailed solutions on the next page by adding a separate Markdown heading "## Detailed Solutions" only after all questions. Do not include solutions inline with questions. For all numerical questions, provide a detailed step-by-step solution showing calculations and working, where each new mathematical step is written on a new line, never combined into a single paragraph. For all MCQ and theory questions, provide the complete explanation/reasoning along with the correct option, not just the option letter alone. Use ${resolvedExamTarget}-appropriate MCQs, assertion-reason where relevant, and numericals. CRITICAL MCQ FORMATTING: Write each option (A-D) on a new line, never inline on a single line. CRITICAL MATH NOTATION: For all mathematics, equations, exponents, and variables, always use valid KaTeX/LaTeX Markdown. Exponents must use carets (e.g., $x^2$, $x^3$), and all mathematical expressions must be wrapped in single dollar signs (e.g. $3\\sqrt{5}$, $f(3) = 0$). Never output raw math or variables without dollar signs, and never use raw exponents like x2 or x3. For all mathematics in DPP, use valid KaTeX Markdown: wrap inline expressions in single dollar signs, e.g. $x = \\frac{6}{3 + \\sqrt{2}}$. Never output raw \\frac or \\sqrt outside dollar signs.`
                            : contentType === 'pyq'
                                ? `Generate ${resolvedExamTarget} previous-year-question style practice only, based on the enrolled course target. Put all detailed solutions on the next page by adding a separate Markdown heading "## Detailed Solutions" only after all questions. Do not include solutions inline with questions. For all numerical questions, provide a detailed step-by-step solution showing calculations and working, where each new mathematical step is written on a new line, never combined into a single paragraph. For all MCQ and theory questions, provide the complete explanation/reasoning along with the correct option, not just the option letter alone. Avoid school-board-only framing unless the course target explicitly requires it. CRITICAL MCQ FORMATTING: Write each option (A-D) on a new line, never inline on a single line. Each question must show the exact real, authentic year and name of the exam (e.g. JEE Main 2019, NEET 2020) next to the question number. It MUST be a real, authentic past year of the exam, never a dummy year or empty placeholder like '____' or 'Year' or '20XX'. CRITICAL MATH NOTATION: For all mathematics, exponents, and variables, always use valid KaTeX/LaTeX Markdown. Exponents must use carets (e.g., $x^2$, $x^3$), and all mathematical expressions must be wrapped in single dollar signs (e.g. $3\\sqrt{5}$, $f(3) = 0$). Never output raw math or variables without dollar signs, and never use raw exponents like x2 or x3. For all mathematics in PYQ, use valid KaTeX Markdown: wrap inline expressions in single dollar signs, e.g. $x = \\frac{6}{3 + \\sqrt{2}}$. Never output raw \\frac or \\sqrt outside dollar signs.`
                                : '';
        const extraContext = [
            isQuestionType ? 'Use only the course exam target supplied in this request; do not mix JEE and NEET unless the target is JEE/NEET.' : '',
            typeSpecificInstruction,
            (dto.extraContext || '').trim(),
        ].filter(Boolean).join('. ') || undefined;

        const result = await this.aiBridgeService.generateTopicContent(
            {
                topicName: topic.name,
                subjectName: subject?.name ?? '',
                chapterName: (topic as any).chapter?.name ?? '',
                contentType,
                difficulty: isQuestionType ? 'intermediate' : dto.difficulty,
                length: isQuestionType ? 'detailed' : dto.length,
                examTarget: resolvedExamTarget,
                courseName: resolvedCourseName,
                extraContext,
                questionCount: dto.questionCount,
            },
            tenantId,
            'coaching',
        );
        return { content: result.content, contentType: result.contentType };
    }

    private resolveCourseExamTarget(raw?: string | null): string {
        const value = String(raw ?? '').trim();
        const lower = value.toLowerCase();
        const hasJee = lower.includes('jee');
        const hasNeet = lower.includes('neet');
        if (lower.includes('both') || (hasJee && hasNeet)) return 'JEE/NEET';
        if (hasNeet) return 'NEET';
        if (hasJee) return 'JEE';
        return value || 'JEE';
    }

    async saveTopicAiResource(
        topicId: string,
        dto: { title: string; content: string; resourceType?: string },
        userId: string,
        tenantId: string,
    ): Promise<TopicResource> {
        const typeMap: Record<string, ResourceType> = {
            dpp: ResourceType.DPP,
            pyq: ResourceType.PYQ,
            faq: ResourceType.FAQ,
            notes: ResourceType.NOTES,
            mindmap: ResourceType.MINDMAP,
        };
        const rType = typeMap[dto.resourceType ?? 'notes'] ?? ResourceType.NOTES;
        return this.createTopicResource(
            topicId,
            { uploadedBy: userId, type: rType, title: dto.title, description: dto.content },
            tenantId,
        );
    }

    private toStudyMaterialType(type: ResourceType): StudyMaterialType | null {
        if (type === ResourceType.PYQ) return StudyMaterialType.PYQ;
        if (type === ResourceType.DPP) return StudyMaterialType.DPP;
        if (type === ResourceType.NOTES || type === ResourceType.PDF || type === ResourceType.MINDMAP) return StudyMaterialType.NOTES;
        return null;
    }

    private toStudyMaterialExams(raw?: string): StudyMaterialExam[] {
        const v = String(raw ?? '').toLowerCase();
        const hasJee = v.includes('jee');
        const hasNeet = v.includes('neet');
        const hasBothKeyword = v.includes('both');
        if (hasBothKeyword || (hasJee && hasNeet)) {
            return [StudyMaterialExam.JEE, StudyMaterialExam.NEET];
        }
        if (hasJee) return [StudyMaterialExam.JEE];
        if (hasNeet) return [StudyMaterialExam.NEET];
        return [];
    }

    private async mirrorTopicResourceToStudyMaterial(
        topicId: string,
        tenantId: string,
        data: {
            uploadedBy: string;
            type: ResourceType;
            title: string;
            fileUrl?: string | null;
            fileKey?: string | null;
            externalUrl?: string | null;
            fileSizeKb?: number;
            description?: string;
            sortOrder?: number;
        },
    ): Promise<void> {
        // Only file-based resources can be listed/downloaded via study_materials.
        if (!data.fileUrl || !data.fileKey) return;
        const mappedType = this.toStudyMaterialType(data.type);
        if (!mappedType) return;

        const topic = await this.topicRepo.findOne({
            where: { id: topicId, tenantId },
            relations: ['chapter', 'chapter.subject'],
        });
        const exams = this.toStudyMaterialExams((topic as any)?.chapter?.subject?.examTarget);
        if (exams.length === 0) return;

        const subjectName = (topic as any)?.chapter?.subject?.name ?? undefined;
        const chapterName = (topic as any)?.chapter?.name ?? undefined;

        for (const exam of exams) {
            const row = this.studyMaterialRepo.create({
                tenantId,
                exam,
                type: mappedType,
                title: data.title,
                subject: subjectName,
                chapter: chapterName,
                description: data.description,
                s3Key: data.fileKey,
                fileSizeKb: data.fileSizeKb,
                previewPages: 2,
                uploadedBy: data.uploadedBy,
                isActive: true,
                sortOrder: data.sortOrder ?? 0,
            });
        }
    }

    private async notifyBatchStudentsOfNewResource(topic: Topic, title: string, tenantId: string): Promise<void> {
        // Fetch topic with chapter and subject to find the batches
        const topicWithRelations = await this.topicRepo.findOne({
            where: { id: topic.id },
            relations: ['chapter', 'chapter.subject'],
        });
        const subjectName = (topicWithRelations as any)?.chapter?.subject?.name;
        if (!subjectName) return;

        // Find batches associated with this subject
        const batchSubjectTeachers = await this.batchSubjectTeacherRepo.find({
            where: { subjectName, tenantId },
            select: ['batchId'],
        });
        const batchIds = [...new Set(batchSubjectTeachers.map(b => b.batchId))];
        if (batchIds.length === 0) return;

        // Find enrolled students in these batches
        const enrollments = await this.enrollmentRepo.find({
            where: { batchId: In(batchIds), status: EnrollmentStatus.ACTIVE },
            relations: ['student', 'student.user'],
        });

        const targets = enrollments.filter(e => e.student?.user?.id);
        const uniqueUserIds = new Set<string>();

        await Promise.allSettled(
            targets.map(e => {
                const userId = e.student!.user!.id;
                if (uniqueUserIds.has(userId)) return Promise.resolve();
                uniqueUserIds.add(userId);

                const recipientTenantId = e.student!.user!.tenantId ?? e.student!.tenantId ?? tenantId;
                return this.notificationService.send({
                    userId,
                    tenantId: recipientTenantId,
                    title: '📚 New Study Material',
                    body: `"${title}" has been added to ${topic.name}. Check it out!`,
                    channels: ['in_app', 'push'],
                    refType: 'topic_resource',
                    refId: topic.id,
                });
            }),
        );
    }

    async getAiStudyHistory(userId: string, tenantId: string) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) return [];

        const sessions = await this.aiStudyRepo.find({
            where: { studentId: student.id },
            relations: ['topic', 'topic.chapter', 'topic.chapter.subject'],
            order: { createdAt: 'DESC' },
        });

        return sessions.map((session) => ({
            id: session.id,
            topicId: session.topicId,
            topicName: session.topic?.name,
            subjectName: session.topic?.chapter?.subject?.name,
            lessonMarkdown: this.normalizeSolvedExamplesFormatting(session.lessonMarkdown),
            keyConcepts: session.keyConcepts,
            formulas: session.formulas,
            practiceQuestions: session.practiceQuestions,
            conversation: session.conversation,
            isCompleted: session.isCompleted,
            timeSpentSeconds: session.timeSpentSeconds,
            createdAt: session.createdAt,
            completedAt: session.completedAt,
        }));
    }
}
