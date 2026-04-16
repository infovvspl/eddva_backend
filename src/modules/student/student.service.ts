import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Student } from '../../database/entities/student.entity';
import {
  PerformanceProfile,
  WeakTopic,
  LeaderboardEntry,
  LeaderboardScope,
} from '../../database/entities/analytics.entity';
import { Lecture, LectureProgress, LectureStatus, StudyPlan, PlanItem } from '../../database/entities/learning.entity';
import { Batch, BatchStatus, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { Subject, Chapter, Topic, TopicResource } from '../../database/entities/subject.entity';
import { TopicProgress, TopicStatus } from '../../database/entities/assessment.entity';

@Injectable()
export class StudentService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(PerformanceProfile)
    private readonly profileRepo: Repository<PerformanceProfile>,
    @InjectRepository(WeakTopic)
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(LeaderboardEntry)
    private readonly leaderboardRepo: Repository<LeaderboardEntry>,
    @InjectRepository(StudyPlan)
    private readonly planRepo: Repository<StudyPlan>,
    @InjectRepository(PlanItem)
    private readonly planItemRepo: Repository<PlanItem>,
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(BatchSubjectTeacher)
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    @InjectRepository(TopicResource)
    private readonly resourceRepo: Repository<TopicResource>,
    @InjectRepository(TopicProgress)
    private readonly topicProgressRepo: Repository<TopicProgress>,
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(LectureProgress)
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    private readonly dataSource: DataSource,
  ) {}

  async getDashboard(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({
      where: { userId, tenantId },
      relations: ['user'],
    });
    if (!student) throw new NotFoundException('Student not found');

    const [profile, weakTopics, todayPlan, globalRank] = await Promise.all([
      this.profileRepo.findOne({ where: { studentId: student.id } }),
      this.weakTopicRepo.find({
        where: { studentId: student.id },
        relations: ['topic'],
        order: { severity: 'DESC' },
        take: 5,
      }),
      this.getTodayPlanItems(student.id),
      this.leaderboardRepo.findOne({
        where: { studentId: student.id, scope: LeaderboardScope.GLOBAL },
      }),
    ]);

    return {
      student,
      predictedRank: profile?.predictedRank,
      overallAccuracy: profile?.overallAccuracy,
      currentStreak: student.currentStreak,
      xpTotal: student.xpTotal,
      weakTopics,
      todayPlan,
      globalRank: globalRank?.rank,
      globalPercentile: globalRank?.percentile,
    };
  }

  async getTodayPlanItems(studentId: string) {
    const today = new Date().toISOString().split('T')[0];
    const plan = await this.planRepo.findOne({ where: { studentId } });
    if (!plan) return [];
    return this.planItemRepo.find({
      where: { studyPlanId: plan.id, scheduledDate: today },
      order: { sortOrder: 'ASC' },
    });
  }

  async getWeakTopics(studentId: string) {
    return this.weakTopicRepo.find({
      where: { studentId },
      relations: ['topic', 'topic.chapter', 'topic.chapter.subject'],
      order: { severity: 'DESC' },
    });
  }

  async updateStreak(studentId: string) {
    const student = await this.studentRepo.findOne({ where: { id: studentId } });
    if (!student) return;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    if (student.lastActiveDate === today) return;

    if (student.lastActiveDate === yesterday) {
      student.currentStreak += 1;
      if (student.currentStreak > student.longestStreak) {
        student.longestStreak = student.currentStreak;
      }
    } else {
      student.currentStreak = 1;
    }
    student.lastActiveDate = today;
    await this.studentRepo.save(student);
  }

  async awardXp(studentId: string, amount: number) {
    await this.studentRepo.increment({ id: studentId }, 'xpTotal', amount);
  }

  // ─── COURSE DASHBOARD (student view) ────────────────────────────────────────

  /** List all enrolled courses with progress overview */
  async getMyCourses(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    const enrollments = await this.enrollmentRepo.find({
      where: { studentId: student.id },
      relations: ['batch', 'batch.teacher'],
      order: { enrolledAt: 'DESC' },
    });

    const results = await Promise.all(
      enrollments.map(async (e) => {
        const batch = e.batch;

        // Count subjects assigned to this batch
        const subjectAssignments = await this.batchSubjectTeacherRepo.find({
          where: { batchId: batch.id },
        });
        const subjectNames = [...new Set(subjectAssignments.map(a => a.subjectName))];

        // Get total topics and student completed topics via topic_progress
        const topicProgressRows = await this.dataSource.query(`
          SELECT tp.status, COUNT(*)::int AS cnt
          FROM topic_progress tp
          JOIN topics t ON t.id = tp.topic_id
          JOIN chapters c ON c.id = t.chapter_id
          JOIN subjects s ON s.id = c.subject_id
          JOIN batch_subject_teachers bst
            ON LOWER(bst.subject_name) = LOWER(s.name)
            AND bst.batch_id = $1
          WHERE tp.student_id = $2
            AND tp.deleted_at IS NULL
          GROUP BY tp.status
        `, [batch.id, student.id]);

        const completedTopics = topicProgressRows.find(r => r.status === TopicStatus.COMPLETED)?.cnt ?? 0;
        const inProgressTopics = topicProgressRows.find(r => r.status === TopicStatus.IN_PROGRESS)?.cnt ?? 0;

        // Total published lectures in this batch
        const totalLectures = await this.lectureRepo.count({
          where: { batchId: batch.id, status: LectureStatus.PUBLISHED },
        });

        // Watched lectures by student
        const watchedLectures = await this.dataSource.query(`
          SELECT COUNT(DISTINCT lp.lecture_id)::int AS cnt
          FROM lecture_progress lp
          JOIN lectures l ON l.id = lp.lecture_id
          WHERE l.batch_id = $1
            AND lp.student_id = $2
            AND lp.is_completed = true
        `, [batch.id, student.id]);

        return {
          enrollmentId:    e.id,
          enrollmentStatus: e.status,
          enrolledAt:      e.enrolledAt,
          feePaid:         e.feePaid,
          batch: {
            id:           batch.id,
            name:         batch.name,
            description:  batch.description ?? null,
            examTarget:   batch.examTarget,
            class:        batch.class,
            startDate:    batch.startDate ?? null,
            endDate:      batch.endDate ?? null,
            thumbnailUrl: batch.thumbnailUrl ?? null,
            status:       batch.status,
            teacher:      batch.teacher ? { id: batch.teacher.id, fullName: batch.teacher.fullName } : null,
          },
          subjects:          subjectNames,
          progress: {
            totalLectures,
            watchedLectures:  watchedLectures[0]?.cnt ?? 0,
            completedTopics:  Number(completedTopics),
            inProgressTopics: Number(inProgressTopics),
          },
        };
      }),
    );

    return results;
  }

  /** Full course curriculum: subjects → chapters → topics with resources + progress */
  async getCourseDetail(batchId: string, userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    // Verify enrollment
    const enrollment = await this.enrollmentRepo.findOne({
      where: { batchId, studentId: student.id },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled in this course');

    // No tenantId filter — students can enroll in batches across tenants
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    // Subjects assigned to this batch
    const assignments = await this.batchSubjectTeacherRepo.find({
      where: { batchId },
    });

    // Primary: subjects linked directly via batchId column
    let filteredSubjects = await this.subjectRepo.find({
      where: { batchId, isActive: true },
      relations: ['chapters', 'chapters.topics', 'chapters.topics.resources'],
      order: { sortOrder: 'ASC' },
    });

    // Fallback: match by name via batch_subject_teachers (legacy batches)
    if (filteredSubjects.length === 0 && assignments.length > 0) {
      const assignedNames = [...new Set(assignments.map(a => a.subjectName.toLowerCase()))];
      const allSubjects = await this.subjectRepo.find({
        where: { tenantId, isActive: true },
        relations: ['chapters', 'chapters.topics', 'chapters.topics.resources'],
        order: { sortOrder: 'ASC' },
      });
      filteredSubjects = allSubjects.filter(s =>
        assignedNames.includes(s.name.toLowerCase()),
      );
    }

    // Topic IDs in this course (for bulk progress fetch)
    const allTopicIds: string[] = [];
    for (const s of filteredSubjects) {
      for (const c of s.chapters ?? []) {
        for (const t of c.topics ?? []) {
          allTopicIds.push(t.id);
        }
      }
    }

    // Batch-load topic progress for this student
    const topicProgressList = allTopicIds.length
      ? await this.topicProgressRepo.find({
          where: { studentId: student.id, topicId: In(allTopicIds) },
        })
      : [];
    const progressMap = new Map(topicProgressList.map(p => [p.topicId, p]));

    // Batch-load lecture counts per topic for this batch
    const lectureCounts: Array<{ topic_id: string; total: string; completed: string }> =
      allTopicIds.length
        ? await this.dataSource.query(`
            SELECT
              l.topic_id,
              COUNT(l.id)::int                                           AS total,
              COUNT(lp.id) FILTER (WHERE lp.is_completed = true)::int   AS completed
            FROM lectures l
            LEFT JOIN lecture_progress lp
              ON lp.lecture_id = l.id AND lp.student_id = $1
            WHERE l.batch_id = $2
              AND l.topic_id = ANY($3)
              AND l.status = 'published'
              AND l.deleted_at IS NULL
            GROUP BY l.topic_id
          `, [student.id, batchId, allTopicIds])
        : [];
    const lectureCountMap = new Map(lectureCounts.map(r => [r.topic_id, r]));

    // Build teacher info per subject
    const teacherMap = new Map<string, { id: string; name: string } | null>();
    for (const a of assignments) {
      const teacher = await this.dataSource.query(
        `SELECT u.id, u.full_name AS name FROM users u WHERE u.id = $1 LIMIT 1`,
        [a.teacherId],
      );
      teacherMap.set(a.subjectName.toLowerCase(), teacher[0] ?? null);
    }

    // Build response tree
    const curriculum = filteredSubjects.map(subject => ({
      id:         subject.id,
      name:       subject.name,
      icon:       subject.icon ?? null,
      colorCode:  subject.colorCode ?? null,
      teacher:    teacherMap.get(subject.name.toLowerCase()) ?? null,
      chapters: (subject.chapters ?? [])
        .filter(c => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(chapter => ({
          id:             chapter.id,
          name:           chapter.name,
          jeeWeightage:   chapter.jeeWeightage,
          neetWeightage:  chapter.neetWeightage,
          topics: (chapter.topics ?? [])
            .filter(t => t.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(topic => {
              const prog      = progressMap.get(topic.id);
              const lec       = lectureCountMap.get(topic.id);
              const activeRes = (topic.resources ?? []).filter(r => r.isActive);

              // Count resources by type for locked-state preview
              const resourceCounts = activeRes.reduce<Record<string, number>>((acc, r) => {
                acc[r.type] = (acc[r.type] ?? 0) + 1;
                return acc;
              }, {});

              const lectureCount = lec ? Number(lec.total) : 0;

              return {
                id:                    topic.id,
                name:                  topic.name,
                estimatedStudyMinutes: topic.estimatedStudyMinutes,
                gatePassPercentage:    topic.gatePassPercentage,
                progress: {
                  status:        prog?.status ?? TopicStatus.LOCKED,
                  bestAccuracy:  prog?.bestAccuracy ?? 0,
                  completedAt:   prog?.completedAt ?? null,
                },
                lectureCount,
                lectures: {
                  total:     lectureCount,
                  completed: lec ? Number(lec.completed) : 0,
                },
                resourceCounts,
                resources: activeRes
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map(r => ({
                    id:          r.id,
                    type:        r.type,
                    title:       r.title,
                    fileUrl:     r.fileUrl,
                    fileSizeKb:  r.fileSizeKb ?? null,
                    description: r.description ?? null,
                  })),
              };
            }),
        })),
    }));

    // Overall batch progress summary
    const totalTopics    = allTopicIds.length;
    const completedCount = topicProgressList.filter(p => p.status === TopicStatus.COMPLETED).length;
    const totalLectures  = lectureCounts.reduce((s, r) => s + Number(r.total), 0);
    const watchedLectures = lectureCounts.reduce((s, r) => s + Number(r.completed), 0);

    return {
      batch: {
        id:           batch.id,
        name:         batch.name,
        examTarget:   batch.examTarget,
        class:        batch.class,
        startDate:    batch.startDate,
        endDate:      batch.endDate,
        thumbnailUrl: batch.thumbnailUrl ?? null,
        status:       batch.status,
      },
      enrollment: {
        id:        enrollment.id,
        status:    enrollment.status,
        enrolledAt: enrollment.enrolledAt,
        feePaid:   enrollment.feePaid,
      },
      summary: {
        totalSubjects:   filteredSubjects.length,
        totalTopics,
        completedTopics: completedCount,
        totalLectures,
        watchedLectures,
        progressPercent: totalTopics > 0
          ? Math.round((completedCount / totalTopics) * 100)
          : 0,
      },
      curriculum,
    };
  }

  /** Single topic detail — lectures list + resources + progress */
  async getTopicDetail(batchId: string, topicId: string, userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    const enrollment = await this.enrollmentRepo.findOne({
      where: { batchId, studentId: student.id },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled in this course');

    // No tenantId filter — topic belongs to the batch's tenant, not necessarily the student's
    const topic = await this.topicRepo.findOne({
      where: { id: topicId },
      relations: ['chapter', 'chapter.subject', 'resources'],
    });
    if (!topic) throw new NotFoundException('Topic not found');

    const [lectures, topicProgress] = await Promise.all([
      this.lectureRepo.find({
        where: { batchId, topicId, status: LectureStatus.PUBLISHED },
        order: { createdAt: 'ASC' },
      }),
      this.topicProgressRepo.findOne({ where: { studentId: student.id, topicId } }),
    ]);

    // Lecture progress for this student
    const lectureIds = lectures.map(l => l.id);
    const lectureProgressList = lectureIds.length
      ? await this.lectureProgressRepo.find({
          where: { studentId: student.id, lectureId: In(lectureIds) },
        })
      : [];
    const lecProgMap = new Map(lectureProgressList.map(p => [p.lectureId, p]));

    return {
      topic: {
        id:                    topic.id,
        name:                  topic.name,
        estimatedStudyMinutes: topic.estimatedStudyMinutes,
        gatePassPercentage:    topic.gatePassPercentage,
        chapter: {
          id:   topic.chapter?.id,
          name: topic.chapter?.name,
        },
        subject: {
          id:   (topic.chapter as any)?.subject?.id,
          name: (topic.chapter as any)?.subject?.name,
        },
      },
      progress: {
        status:       topicProgress?.status ?? TopicStatus.LOCKED,
        bestAccuracy: topicProgress?.bestAccuracy ?? 0,
        studiedWithAi: topicProgress?.studiedWithAi ?? false,
        completedAt:  topicProgress?.completedAt ?? null,
      },
      lectures: lectures.map(l => {
        const lp = lecProgMap.get(l.id);
        return {
          id:              l.id,
          title:           l.title,
          type:            l.type,
          videoUrl:        l.videoUrl ?? null,
          durationSeconds: (l as any).videoDurationSeconds ?? null,
          thumbnailUrl:    l.thumbnailUrl ?? null,
          progress: {
            watchPercentage:     lp?.watchPercentage ?? 0,
            lastPositionSeconds: lp?.lastPositionSeconds ?? 0,
            isCompleted:         lp?.isCompleted ?? false,
          },
        };
      }),
      resources: (topic.resources ?? [])
        .filter(r => r.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(r => ({
          id:          r.id,
          type:        r.type,
          title:       r.title,
          fileUrl:     r.fileUrl,
          fileSizeKb:  r.fileSizeKb ?? null,
          description: r.description ?? null,
        })),
    };
  }

  // ─── CONTINUE LEARNING ────────────────────────────────────────────────────────

  async getContinueLearning(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    // Last in-progress lecture progress, most recently updated
    const lastProgress = await this.lectureProgressRepo.findOne({
      where: { studentId: student.id, isCompleted: false },
      order: { updatedAt: 'DESC' },
    });

    if (!lastProgress) {
      // No in-progress lecture — return the first unstarted lecture from enrolled batches
      const enrollments = await this.enrollmentRepo.find({ where: { studentId: student.id } });
      const batchIds = enrollments.map(e => e.batchId);
      if (!batchIds.length) return null;

      const startedIds = await this.lectureProgressRepo
        .find({ where: { studentId: student.id } })
        .then(rows => rows.map(r => r.lectureId));

      const nextLecture = await this.lectureRepo
        .createQueryBuilder('l')
        .leftJoinAndSelect('l.topic', 't')
        .leftJoinAndSelect('t.chapter', 'c')
        .leftJoinAndSelect('c.subject', 's')
        .where('l.batchId IN (:...batchIds)', { batchIds })
        .andWhere('l.status = :status', { status: LectureStatus.PUBLISHED })
        .andWhere(startedIds.length ? 'l.id NOT IN (:...startedIds)' : '1=1',
          startedIds.length ? { startedIds } : {})
        .orderBy('l.createdAt', 'ASC')
        .getOne();

      if (!nextLecture) return null;

      return {
        lectureId:           nextLecture.id,
        lectureTitle:        nextLecture.title,
        videoUrl:            nextLecture.videoUrl ?? null,
        thumbnailUrl:        nextLecture.thumbnailUrl ?? null,
        resumeAtSeconds:     0,
        watchPercentage:     0,
        isCompleted:         false,
        topicName:           (nextLecture as any).topic?.name ?? null,
        chapterName:         (nextLecture as any).topic?.chapter?.name ?? null,
        subjectName:         (nextLecture as any).topic?.chapter?.subject?.name ?? null,
        batchId:             nextLecture.batchId,
      };
    }

    const lecture = await this.lectureRepo.findOne({
      where: { id: lastProgress.lectureId },
      relations: ['topic', 'topic.chapter', 'topic.chapter.subject'],
    });

    return {
      lectureId:        lecture?.id,
      lectureTitle:     lecture?.title,
      videoUrl:         lecture?.videoUrl ?? null,
      thumbnailUrl:     lecture?.thumbnailUrl ?? null,
      resumeAtSeconds:  lastProgress.lastPositionSeconds ?? 0,
      watchPercentage:  lastProgress.watchPercentage ?? 0,
      isCompleted:      lastProgress.isCompleted,
      topicName:        (lecture as any)?.topic?.name ?? null,
      chapterName:      (lecture as any)?.topic?.chapter?.name ?? null,
      subjectName:      (lecture as any)?.topic?.chapter?.subject?.name ?? null,
      batchId:          lecture?.batchId,
    };
  }

  // ─── WEEKLY ACTIVITY ─────────────────────────────────────────────────────────

  async getWeeklyActivity(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    // Last 7 days
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });

    // Lectures watched per day
    const lectureActivity: Array<{ day: string; cnt: string }> = await this.dataSource.query(`
      SELECT DATE(lp.updated_at AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS cnt
      FROM lecture_progress lp
      WHERE lp.student_id = $1
        AND lp.updated_at >= NOW() - INTERVAL '7 days'
        AND lp.watch_percentage > 0
      GROUP BY day
    `, [student.id]);

    // Topics completed per day
    const topicActivity: Array<{ day: string; cnt: string }> = await this.dataSource.query(`
      SELECT DATE(tp.updated_at AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS cnt
      FROM topic_progress tp
      WHERE tp.student_id = $1
        AND tp.updated_at >= NOW() - INTERVAL '7 days'
        AND tp.status = 'completed'
      GROUP BY day
    `, [student.id]);

    // Tests taken per day
    const testActivity: Array<{ day: string; cnt: string }> = await this.dataSource.query(`
      SELECT DATE(ts.submitted_at AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS cnt
      FROM test_sessions ts
      WHERE ts.student_id = $1
        AND ts.submitted_at >= NOW() - INTERVAL '7 days'
        AND ts.status IN ('submitted', 'auto_submitted')
      GROUP BY day
    `, [student.id]);

    const lectureMap = new Map(lectureActivity.map(r => [r.day, Number(r.cnt)]));
    const topicMap   = new Map(topicActivity.map(r => [r.day, Number(r.cnt)]));
    const testMap    = new Map(testActivity.map(r => [r.day, Number(r.cnt)]));

    const activity = days.map(day => ({
      date:             day,
      dayLabel:         new Date(day).toLocaleDateString('en-US', { weekday: 'short' }),
      lecturesWatched:  lectureMap.get(day) ?? 0,
      topicsCompleted:  topicMap.get(day) ?? 0,
      testsTaken:       testMap.get(day) ?? 0,
      isActive:         (lectureMap.get(day) ?? 0) + (topicMap.get(day) ?? 0) + (testMap.get(day) ?? 0) > 0,
    }));

    const activeDays = activity.filter(d => d.isActive).length;

    return {
      weeklyActivity: activity,
      summary: {
        activeDays,
        totalLecturesWatched: activity.reduce((s, d) => s + d.lecturesWatched, 0),
        totalTopicsCompleted: activity.reduce((s, d) => s + d.topicsCompleted, 0),
        totalTestsTaken:      activity.reduce((s, d) => s + d.testsTaken, 0),
        currentStreak:        student.currentStreak,
        longestStreak:        student.longestStreak,
      },
    };
  }

  // ─── PROFILE ─────────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const student = await this.studentRepo.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (!student) throw new NotFoundException('Student profile not found');

    return {
      id:                   student.id,
      userId:               student.userId,
      fullName:             (student as any).user?.fullName,
      email:                (student as any).user?.email,
      phoneNumber:          (student as any).user?.phoneNumber,
      careOf:               student.careOf,
      alternatePhoneNumber: student.alternatePhoneNumber,
      address:              student.address,
      postOffice:           student.postOffice,
      city:                 student.city,
      landmark:             student.landmark,
      state:                student.state,
      pinCode:              student.pinCode,
      examTarget:           student.examTarget,
      class:                student.class,
      examYear:             student.examYear,
      targetCollege:        student.targetCollege,
      dailyStudyHours:      student.dailyStudyHours,
      language:             student.language,
      xpTotal:              student.xpTotal,
      currentStreak:        student.currentStreak,
      longestStreak:        student.longestStreak,
      subscriptionPlan:     student.subscriptionPlan,
    };
  }

  async updateProfile(userId: string, dto: {
    careOf?: string;
    alternatePhoneNumber?: string;
    address?: string;
    postOffice?: string;
    city?: string;
    landmark?: string;
    state?: string;
    pinCode?: string;
    targetCollege?: string;
    dailyStudyHours?: number;
    examTarget?: string;
    class?: string;
    examYear?: string;
  }) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');
    Object.assign(student, dto);
    await this.studentRepo.save(student);
    return this.getProfile(userId);
  }

  // ─── DISCOVER BATCHES (login modal) ──────────────────────────────────────────

  async discoverBatches(userId: string, _tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    // Already enrolled batch IDs (cross-tenant)
    const enrollments = await this.enrollmentRepo.find({ where: { studentId: student.id } });
    const enrolledBatchIds = enrollments.map(e => e.batchId);

    // Query ALL active batches across ALL institutes (no tenantId filter)
    const qb = this.batchRepo.createQueryBuilder('b')
      .leftJoinAndSelect('b.teacher', 'teacher')
      .where('b.status = :status', { status: BatchStatus.ACTIVE })
      .andWhere('b.deleted_at IS NULL');

    // Exclude already enrolled
    if (enrolledBatchIds.length) {
      qb.andWhere('b.id NOT IN (:...enrolledBatchIds)', { enrolledBatchIds });
    }

    const batches = await qb.orderBy('b.created_at', 'DESC').getMany();

    // Count enrollments per batch for studentCount
    const batchIds = batches.map(b => b.id);
    let enrollmentCounts: Record<string, number> = {};
    if (batchIds.length) {
      const counts: Array<{ batch_id: string; cnt: string }> = await this.dataSource.query(
        `SELECT batch_id, COUNT(*)::int AS cnt FROM enrollments
         WHERE batch_id = ANY($1) AND status = 'active' AND deleted_at IS NULL
         GROUP BY batch_id`,
        [batchIds],
      );
      enrollmentCounts = Object.fromEntries(counts.map(r => [r.batch_id, Number(r.cnt)]));
    }

    return {
      studentPreferences: {
        examTarget: student.examTarget ?? null,
        class:      student.class ?? null,
        examYear:   student.examYear ?? null,
      },
      isFirstLogin:   enrolledBatchIds.length === 0,
      availableBatches: batches.map(b => ({
        id:           b.id,
        name:         b.name,
        description:  b.description ?? null,
        examTarget:   b.examTarget,
        class:        b.class,
        startDate:    b.startDate ?? null,
        endDate:      b.endDate ?? null,
        thumbnailUrl: b.thumbnailUrl ?? null,
        status:       b.status,
        isPaid:       b.isPaid,
        feeAmount:    b.feeAmount ?? null,
        maxStudents:  b.maxStudents,
        studentCount: enrollmentCounts[b.id] ?? 0,
        teacher:      b.teacher ? { id: b.teacher.id, fullName: b.teacher.fullName } : null,
      })),
    };
  }

  async enrollInBatch(userId: string, batchId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    // Find batch across all tenants
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.status !== BatchStatus.ACTIVE) {
      throw new BadRequestException('This batch is no longer accepting enrollments');
    }

    // Already enrolled?
    const existing = await this.enrollmentRepo.findOne({
      where: { studentId: student.id, batchId },
    });
    if (existing) return { message: 'Already enrolled in this batch' };

    // Capacity check
    const enrolledCount = await this.enrollmentRepo.count({
      where: { batchId, status: EnrollmentStatus.ACTIVE },
    });
    if (batch.maxStudents && enrolledCount >= batch.maxStudents) {
      throw new BadRequestException('This batch is full');
    }

    const enrollment = this.enrollmentRepo.create({
      tenantId:  batch.tenantId,
      studentId: student.id,
      batchId:   batch.id,
      status:    EnrollmentStatus.ACTIVE,
    });
    await this.enrollmentRepo.save(enrollment);

    return { message: 'Successfully enrolled' };
  }

  // ─── PUBLIC BATCH PREVIEW (no enrollment required) ────────────────────────────

  async getBatchPreview(batchId: string, userId: string) {
    const batch = await this.batchRepo.findOne({
      where: { id: batchId },
      relations: ['teacher'],
    });
    if (!batch || batch.status !== BatchStatus.ACTIVE) {
      throw new NotFoundException('Course not found');
    }

    // Is this student enrolled?
    const student = await this.studentRepo.findOne({ where: { userId } });
    const enrollment = student
      ? await this.enrollmentRepo.findOne({ where: { batchId, studentId: student.id } })
      : null;

    // Count enrolled students
    const enrolledCount = await this.enrollmentRepo.count({
      where: { batchId, status: EnrollmentStatus.ACTIVE },
    });

    // Load full curriculum — subjects → chapters → topics (no resources for preview)
    const assignments = await this.batchSubjectTeacherRepo.find({ where: { batchId } });

    // Primary: subjects linked directly via batchId column
    let filteredSubjects = await this.subjectRepo.find({
      where: { batchId, isActive: true },
      relations: ['chapters', 'chapters.topics', 'chapters.topics.resources'],
      order: { sortOrder: 'ASC' },
    });

    // Fallback: match by name via batch_subject_teachers (legacy batches)
    if (filteredSubjects.length === 0 && assignments.length > 0) {
      const assignedNames = [...new Set(assignments.map(a => a.subjectName.toLowerCase()))];
      const allSubjects = await this.subjectRepo.find({
        where: { isActive: true },
        relations: ['chapters', 'chapters.topics', 'chapters.topics.resources'],
        order: { sortOrder: 'ASC' },
      });
      filteredSubjects = allSubjects.filter(s =>
        assignedNames.includes(s.name.toLowerCase()),
      );
    }

    // Bulk lecture counts for all topics in this batch
    const allTopicIds = filteredSubjects.flatMap(s =>
      (s.chapters ?? []).flatMap(c => (c.topics ?? []).map(t => t.id)),
    );
    const lectureCounts: Array<{ topic_id: string; total: string }> = allTopicIds.length
      ? await this.dataSource.query(`
          SELECT topic_id, COUNT(*)::int AS total
          FROM lectures
          WHERE batch_id = $1
            AND topic_id = ANY($2)
            AND status = 'published'
            AND deleted_at IS NULL
          GROUP BY topic_id
        `, [batchId, allTopicIds])
      : [];
    const lectureCountMap = new Map(lectureCounts.map(r => [r.topic_id, Number(r.total)]));

    // Teacher map per subject
    const teacherMap = new Map<string, { id: string; name: string } | null>();
    for (const a of assignments) {
      const rows = await this.dataSource.query(
        `SELECT u.id, u.full_name AS name FROM users u WHERE u.id = $1 LIMIT 1`,
        [a.teacherId],
      );
      teacherMap.set(a.subjectName.toLowerCase(), rows[0] ?? null);
    }

    const curriculum = filteredSubjects.map(subject => ({
      id:        subject.id,
      name:      subject.name,
      icon:      subject.icon ?? null,
      colorCode: subject.colorCode ?? null,
      teacher:   teacherMap.get(subject.name.toLowerCase()) ?? null,
      chapters: (subject.chapters ?? [])
        .filter(c => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(chapter => ({
          id:            chapter.id,
          name:          chapter.name,
          jeeWeightage:  chapter.jeeWeightage,
          neetWeightage: chapter.neetWeightage,
          topics: (chapter.topics ?? [])
            .filter(t => t.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(topic => {
              const activeRes = (topic.resources ?? []).filter(r => r.isActive);
              const resourceCounts = activeRes.reduce<Record<string, number>>((acc, r) => {
                acc[r.type] = (acc[r.type] ?? 0) + 1;
                return acc;
              }, {});
              return {
                id:                    topic.id,
                name:                  topic.name,
                estimatedStudyMinutes: topic.estimatedStudyMinutes,
                lectureCount:          lectureCountMap.get(topic.id) ?? 0,
                resourceCounts,
              };
            }),
        })),
    }));

    const totalTopics = curriculum.reduce(
      (s, sub) => s + sub.chapters.reduce((cs, ch) => cs + ch.topics.length, 0),
      0,
    );

    return {
      id:           batch.id,
      name:         batch.name,
      examTarget:   batch.examTarget,
      class:        batch.class,
      thumbnailUrl: batch.thumbnailUrl ?? null,
      isPaid:       batch.isPaid,
      feeAmount:    batch.feeAmount ?? null,
      maxStudents:  batch.maxStudents,
      startDate:    batch.startDate ?? null,
      endDate:      batch.endDate ?? null,
      status:       batch.status,
      teacher:      batch.teacher ? { id: batch.teacher.id, fullName: batch.teacher.fullName } : null,
      studentCount: enrolledCount,
      subjectNames: filteredSubjects.map(s => s.name),
      isEnrolled:   !!enrollment,
      feePaid:      enrollment?.feePaid ?? null,
      curriculum,
      totalTopics,
    };
  }
}
