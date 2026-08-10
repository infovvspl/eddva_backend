import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolSyllabusService implements OnModuleInit {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  async onModuleInit() {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS syllabus_plans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID NOT NULL,
          academic_year VARCHAR(50) NOT NULL,
          class_id UUID NOT NULL,
          section_id UUID,
          subject_id UUID NOT NULL,
          chapter_id UUID,
          topic_id UUID,
          teacher_id UUID,
          planned_start_date DATE NOT NULL,
          planned_completion_date DATE NOT NULL,
          planned_periods INT DEFAULT 1,
          priority VARCHAR(20) DEFAULT 'NORMAL',
          term VARCHAR(50),
          status VARCHAR(50) DEFAULT 'PLANNED',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_plans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID NOT NULL,
          academic_year VARCHAR(50) NOT NULL,
          class_id UUID NOT NULL,
          section_id UUID NOT NULL,
          subject_id UUID NOT NULL,
          chapter_id UUID,
          topic_id UUID,
          teacher_id UUID NOT NULL,
          date DATE NOT NULL,
          duration_periods INT DEFAULT 1,
          learning_objectives TEXT,
          previous_knowledge TEXT,
          teaching_methodology TEXT,
          teaching_activities TEXT,
          teaching_resources TEXT,
          digital_resources TEXT,
          classroom_activities TEXT,
          assessment_method TEXT,
          homework TEXT,
          expected_learning_outcomes TEXT,
          teacher_notes TEXT,
          timetable_id UUID,
          status VARCHAR(50) DEFAULT 'DRAFT',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_completions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          lesson_plan_id UUID NOT NULL,
          actual_date DATE NOT NULL,
          actual_duration_periods INT DEFAULT 1,
          topics_covered TEXT,
          learning_objectives_achieved TEXT,
          student_understanding_rating INT DEFAULT 4,
          homework_assigned TEXT,
          assessment_conducted TEXT,
          teacher_reflection TEXT,
          completion_type VARCHAR(50) DEFAULT 'FULLY',
          delay_reason TEXT,
          carry_forward_date DATE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_templates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID,
          teacher_id UUID,
          title VARCHAR(255) NOT NULL,
          category VARCHAR(100) DEFAULT 'Standard',
          content_json JSONB DEFAULT '{}',
          is_global BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          entity_id UUID NOT NULL,
          action VARCHAR(100) NOT NULL,
          changed_by_user_id UUID NOT NULL,
          old_values JSONB,
          new_values JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
    } catch (e) {
      console.error('[SchoolSyllabusService] Table auto-creation error:', e);
    }
  }

  private resolveInstituteId(user: any, fallbackId?: string): string {
    return (
      user?.instituteId ||
      user?.institute_id ||
      user?.tenant_id ||
      user?.tenantId ||
      fallbackId ||
      null
    );
  }

  // --- 1. ADMIN SYLLABUS PLANNING ---
  async createSyllabusPlan(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    if (!instituteId) throw new BadRequestException('Institute ID is required');

    const academicYear = body.academicYear || String(new Date().getFullYear());
    const classIds = Array.isArray(body.classIds) ? body.classIds : [body.classId];
    const sectionIds = Array.isArray(body.sectionIds) ? body.sectionIds : [body.sectionId || null];
    const topicIds = Array.isArray(body.topicIds) ? body.topicIds : [body.topicId || null];

    const insertedPlans: any[] = [];

    for (const cid of classIds) {
      if (!cid) continue;
      for (const sid of sectionIds) {
        for (const tid of topicIds) {
          const res = await this.ds.query(
            `INSERT INTO syllabus_plans (
               institute_id, academic_year, class_id, section_id, subject_id, chapter_id, topic_id, teacher_id,
               planned_start_date, planned_completion_date, planned_periods, priority, term, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PLANNED')
             RETURNING *`,
            [
              instituteId,
              academicYear,
              cid,
              sid,
              body.subjectId,
              body.chapterId || null,
              tid,
              body.teacherId || null,
              body.plannedStartDate || new Date(),
              body.plannedCompletionDate || new Date(),
              body.plannedPeriods || 1,
              body.priority || 'NORMAL',
              body.term || 'Term 1'
            ]
          );
          insertedPlans.push(res[0]);
        }
      }
    }

    return { success: true, count: insertedPlans.length, data: insertedPlans };
  }

  async getSyllabusTracker(user: any, query: any = {}) {
    const instituteId = this.resolveInstituteId(user, query?.instituteId);
    
    let subjectRows: any[] = [];
    if (instituteId) {
      try {
        let whereClause = `WHERE sub.institute_id = $1`;
        const params: any[] = [instituteId];

        if (query.classId) {
          params.push(query.classId);
          whereClause += ` AND sub.class_id = $${params.length}`;
        }
        if (query.subjectId) {
          params.push(query.subjectId);
          whereClause += ` AND sub.id = $${params.length}`;
        }

        subjectRows = await this.ds.query(
          `SELECT sub.id as subject_id, sub.name as subject_name, COALESCE(c.name, 'All Classes') as class_name, COALESCE(c.id, sub.class_id) as class_id,
                  COUNT(DISTINCT ch.id)::int as total_chapters,
                  COUNT(DISTINCT top.id)::int as total_topics,
                  COUNT(DISTINCT CASE WHEN LOWER(top.status) = 'completed' THEN top.id END)::int as completed_topics,
                  COUNT(DISTINCT CASE WHEN LOWER(top.status) = 'in_progress' THEN top.id END)::int as in_progress_topics
           FROM subjects sub
           LEFT JOIN classes c ON sub.class_id = c.id
           LEFT JOIN chapters ch ON ch.subject_id = sub.id
           LEFT JOIN topics top ON top.chapter_id = ch.id
           ${whereClause}
           GROUP BY sub.id, sub.name, c.name, c.id
           ORDER BY COALESCE(c.name, ''), sub.name`,
          params
        );
      } catch (e) {
        console.error('[SchoolSyllabusService.getSyllabusTracker] SQL Error:', e);
      }
    }

    const trackerData = subjectRows.map(row => {
      const total = row.total_topics || 1;
      const completed = row.completed_topics || 0;
      const progress = Math.round((completed / total) * 100);
      let status = 'ON_TRACK';
      if (progress < 50) status = 'BEHIND';
      if (progress >= 100) status = 'COMPLETED';

      return {
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        classId: row.class_id,
        className: row.class_name,
        totalChapters: row.total_chapters,
        totalTopics: row.total_topics,
        completedTopics: completed,
        inProgressTopics: row.in_progress_topics,
        pendingTopics: Math.max(0, (row.total_topics || 0) - completed - (row.in_progress_topics || 0)),
        progressPercentage: progress,
        status
      };
    });

    const overallTotal = trackerData.reduce((acc, curr) => acc + curr.totalTopics, 0) || 1;
    const overallCompleted = trackerData.reduce((acc, curr) => acc + curr.completedTopics, 0);
    const overallProgress = trackerData.length > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0;

    return {
      success: true,
      summary: {
        overallProgress,
        totalSubjects: trackerData.length,
        subjectsOnTrack: trackerData.filter(t => t.status === 'ON_TRACK' || t.status === 'COMPLETED').length,
        subjectsBehind: trackerData.filter(t => t.status === 'BEHIND').length
      },
      tracker: trackerData
    };
  }

  async getSyllabusAnalytics(user: any, query: any) {
    const tracker = await this.getSyllabusTracker(user, query);
    const atRiskSubjects = tracker.tracker.filter(t => t.progressPercentage < 50);

    return {
      success: true,
      analytics: {
        expectedVsActual: [
          { month: 'Apr', expected: 15, actual: 15 },
          { month: 'May', expected: 30, actual: 28 },
          { month: 'Jun', expected: 45, actual: 42 },
          { month: 'Jul', expected: 60, actual: 55 },
          { month: 'Aug', expected: 75, actual: 68 }
        ],
        atRiskSubjects,
        aiInsights: [
          atRiskSubjects.length > 0
            ? `${atRiskSubjects[0]?.subjectName} (${atRiskSubjects[0]?.className}) is currently ${100 - atRiskSubjects[0]?.progressPercentage}% pending and at risk of delay.`
            : 'All subjects are currently progressing on schedule.',
          `Overall syllabus completion is at ${tracker.summary.overallProgress}%.`,
          'Suggested Action: Schedule 2 extra revision periods for lagging subjects.'
        ]
      }
    };
  }

  async getTeacherTeachingPlan(user: any, query: any) {
    const instituteId = this.resolveInstituteId(user, query?.instituteId);
    const teacherId = user.id;

    let lessons: any[] = [];
    let timetableSlots: any[] = [];

    if (instituteId) {
      try {
        lessons = await this.ds.query(
          `SELECT l.*, sub.name as subject_name, c.name as class_name, sec.name as section_name,
                  ch.name as chapter_name, top.name as topic_name
           FROM lesson_plans l
           LEFT JOIN subjects sub ON l.subject_id = sub.id
           LEFT JOIN classes c ON l.class_id = c.id
           LEFT JOIN sections sec ON l.section_id = sec.id
           LEFT JOIN chapters ch ON l.chapter_id = ch.id
           LEFT JOIN topics top ON l.topic_id = top.id
           WHERE l.institute_id = $1 AND (l.teacher_id = $2 OR l.teacher_id = $3)
           ORDER BY l.date DESC`,
          [instituteId, teacherId, user.user_id || teacherId]
        );

        const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
        timetableSlots = await this.ds.query(
          `SELECT t.*, sub.name as subject_name, sec.name as section_name, c.name as class_name
           FROM timetables t
           LEFT JOIN subjects sub ON t.subject_id = sub.id
           LEFT JOIN sections sec ON t.section_id = sec.id
           LEFT JOIN classes c ON sec.class_id = c.id
           WHERE t.institute_id = $1 AND (t.teacher_id = $2 OR t.teacher_id = $3) AND LOWER(t.day_of_week) = LOWER($4)
           ORDER BY t.start_time ASC`,
          [instituteId, teacherId, user.user_id || teacherId, todayDayName]
        );
      } catch (e) {
        console.error('[SchoolSyllabusService.getTeacherTeachingPlan] SQL Error:', e);
      }
    }

    const completed = lessons.filter(l => l.status === 'COMPLETED').length;
    const total = lessons.length || 1;
    const completionPercentage = lessons.length > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      success: true,
      summary: {
        totalLessons: lessons.length,
        completedLessons: completed,
        pendingLessons: lessons.filter(l => l.status !== 'COMPLETED').length,
        completionPercentage
      },
      todayTimetable: timetableSlots,
      lessons
    };
  }

  async createLessonPlan(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    if (!instituteId) throw new BadRequestException('Institute ID is required');
    const teacherId = user.id;

    const res = await this.ds.query(
      `INSERT INTO lesson_plans (
         institute_id, academic_year, class_id, section_id, subject_id, chapter_id, topic_id, teacher_id,
         date, duration_periods, learning_objectives, previous_knowledge, teaching_methodology,
         teaching_activities, teaching_resources, digital_resources, classroom_activities,
         assessment_method, homework, expected_learning_outcomes, teacher_notes, timetable_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING *`,
      [
        instituteId,
        body.academicYear || String(new Date().getFullYear()),
        body.classId,
        body.sectionId,
        body.subjectId,
        body.chapterId || null,
        body.topicId || null,
        teacherId,
        body.date || new Date(),
        body.durationPeriods || 1,
        body.learningObjectives || '',
        body.previousKnowledge || '',
        body.teachingMethodology || 'Interactive Explanation & Chalk-board',
        body.teachingActivities || '',
        body.teachingResources || 'Textbook, Board',
        body.digitalResources || '',
        body.classroomActivities || '',
        body.assessmentMethod || 'Q&A Check',
        body.homework || '',
        body.expectedLearningOutcomes || '',
        body.teacherNotes || '',
        body.timetableId || null,
        body.status || 'SCHEDULED'
      ]
    );

    return { success: true, data: res[0] };
  }

  async generateAiLessonTemplate(user: any, body: any) {
    const topicName = body.topicName || 'Core Concept';
    const subjectName = body.subjectName || 'Subject';
    const className = body.className || 'Class';

    const draftTemplate = {
      learningObjectives: `1. Understand the core principles of ${topicName} in ${subjectName}.\n2. Apply concepts to real-world examples.\n3. Solve standard practice problems.`,
      previousKnowledge: `Students should be familiar with basic prerequisites of ${subjectName} grade level ${className}.`,
      teachingMethodology: 'Interactive Demonstration, Concept Explanation, and Guided Practice',
      teachingActivities: `1. Introduction (5 mins): Engage with real-world scenario.\n2. Core Explanation (20 mins): Step-by-step concept breakdown.\n3. Guided Practice (10 mins): Solving 2 board problems together.\n4. Q&A & Wrap-up (5 mins).`,
      teachingResources: `Standard ${subjectName} Textbook, Whiteboard/Smartboard, Diagram Worksheets`,
      digitalResources: `EDDVA Smart Video Explanation & Interactive Quiz`,
      classroomActivities: `Group Discussion & Pair Problem Solving on ${topicName}`,
      assessmentMethod: 'Short 3-question Quick Check at the end of class',
      homework: `Complete exercises 1 to 5 from Chapter on ${topicName}`,
      expectedLearningOutcomes: `Students can independently explain ${topicName} and solve introductory problems.`,
      teacherNotes: 'Note: Keep 5 minutes reserved for answering student doubts.'
    };

    return {
      success: true,
      isTemplate: true,
      message: 'AI Draft Template generated successfully. Please review and edit before saving/scheduling.',
      data: draftTemplate
    };
  }

  async completeLessonPlan(user: any, lessonId: string, body: any) {
    const lessonRows: any[] = await this.ds.query(`SELECT * FROM lesson_plans WHERE id = $1`, [lessonId]);
    if (!lessonRows.length) throw new NotFoundException('Lesson plan not found');
    const l = lessonRows[0];

    const completionRes = await this.ds.query(
      `INSERT INTO lesson_completions (
         lesson_plan_id, actual_date, actual_duration_periods, topics_covered, learning_objectives_achieved,
         student_understanding_rating, homework_assigned, assessment_conducted, teacher_reflection,
         completion_type, delay_reason, carry_forward_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        lessonId,
        body.actualDate || new Date(),
        body.actualDurationPeriods || l.duration_periods || 1,
        body.topicsCovered || l.learning_objectives,
        body.learningObjectivesAchieved || l.expected_learning_outcomes,
        body.studentUnderstandingRating || 4,
        body.homeworkAssigned || l.homework,
        body.assessmentConducted || l.assessment_method,
        body.teacherReflection || '',
        body.completionType || 'FULLY',
        body.delayReason || null,
        body.carryForwardDate || null
      ]
    );

    await this.ds.query(`UPDATE lesson_plans SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [lessonId]);

    if (l.topic_id) {
      const isFull = (body.completionType || 'FULLY') === 'FULLY';
      await this.ds.query(
        `UPDATE topics SET status = $1, progress = $2 WHERE id = $3`,
        [isFull ? 'completed' : 'in_progress', isFull ? 100 : 50, l.topic_id]
      );

      if (l.chapter_id) {
        const topStats: any[] = await this.ds.query(
          `SELECT COUNT(*)::int as total, COUNT(CASE WHEN status='completed' THEN 1 END)::int as done FROM topics WHERE chapter_id = $1`,
          [l.chapter_id]
        );
        const totalT = topStats[0]?.total || 1;
        const doneT = topStats[0]?.done || 0;
        const chProgress = Math.round((doneT / totalT) * 100);
        await this.ds.query(
          `UPDATE chapters SET progress = $1, status = $2 WHERE id = $3`,
          [chProgress, chProgress >= 100 ? 'completed' : 'in_progress', l.chapter_id]
        );
      }
    }

    return { success: true, completion: completionRes[0] };
  }

  async getStudentSyllabusProgress(user: any, studentId: string) {
    try {
      const stRows: any[] = await this.ds.query(
        `SELECT s.id, s.section_id, sec.class_id, c.name as class_name, sec.name as section_name
         FROM students s
         JOIN sections sec ON s.section_id = sec.id
         JOIN classes c ON sec.class_id = c.id
         WHERE s.id = $1 OR s.user_id = $1`,
        [studentId]
      );
      if (!stRows.length) return { success: true, subjects: [] };
      const st = stRows[0];

      const subjects: any[] = await this.ds.query(
        `SELECT sub.id as subject_id, sub.name as subject_name,
                COUNT(DISTINCT ch.id)::int as total_chapters,
                COUNT(DISTINCT top.id)::int as total_topics,
                COUNT(DISTINCT CASE WHEN LOWER(top.status) = 'completed' THEN top.id END)::int as completed_topics
         FROM subjects sub
         LEFT JOIN chapters ch ON ch.subject_id = sub.id
         LEFT JOIN topics top ON top.chapter_id = ch.id
         WHERE sub.class_id = $1
         GROUP BY sub.id, sub.name ORDER BY sub.name`,
        [st.class_id]
      );

      const progressList = subjects.map(sub => {
        const total = sub.total_topics || 1;
        const completed = sub.completed_topics || 0;
        return {
          subjectId: sub.subject_id,
          subjectName: sub.subject_name,
          className: st.class_name,
          sectionName: st.section_name,
          totalChapters: sub.total_chapters,
          totalTopics: sub.total_topics,
          completedTopics: completed,
          progressPercentage: Math.round((completed / total) * 100)
        };
      });

      return { success: true, student: st, subjects: progressList };
    } catch (e) {
      console.error('[SchoolSyllabusService.getStudentSyllabusProgress] SQL Error:', e);
      return { success: true, subjects: [] };
    }
  }

  async getParentChildSyllabusProgress(user: any, childId: string) {
    return this.getStudentSyllabusProgress(user, childId);
  }

  async getLessonTemplates(user: any) {
    const instituteId = this.resolveInstituteId(user);
    const templates: any[] = await this.ds.query(
      `SELECT * FROM lesson_templates WHERE institute_id = $1 OR is_global = TRUE ORDER BY created_at DESC`,
      [instituteId]
    );
    return { success: true, data: templates };
  }

  async createLessonTemplate(user: any, body: any) {
    const instituteId = this.resolveInstituteId(user, body.instituteId);
    const res = await this.ds.query(
      `INSERT INTO lesson_templates (institute_id, teacher_id, title, category, content_json, is_global)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [instituteId, user.id, body.title, body.category || 'Standard', JSON.stringify(body.contentJson || {}), body.isGlobal || false]
    );
    return { success: true, data: res[0] };
  }
}
