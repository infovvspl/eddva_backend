import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolReportService {
  private resultSchemaReady = false;

  constructor(@InjectDataSource('school') private readonly ds: DataSource) { }

  private async ensureResultSchema() {
    if (this.resultSchemaReady) return;
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS total_marks NUMERIC(5,2) NOT NULL DEFAULT 100`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS percentage NUMERIC(5,2) NOT NULL DEFAULT 0`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT false`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS grade VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS remarks VARCHAR NULL`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'published'`);
    await this.ds.query(`ALTER TABLE results ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    this.resultSchemaReady = true;
  }

  private toNumber(value: any, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private average(values: number[]) {
    const valid = values.filter((value) => Number.isFinite(value));
    if (!valid.length) return 0;
    return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  }

  private dateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private dayLabel(date: Date) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }

  private isTrue(value: any) {
    return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
  }

  private async resolveClassScope(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let classIds = [query.classId || query.class_id].filter(Boolean).map(String);
    let sectionIds = [query.sectionId || query.section_id].filter(Boolean).map(String);
    let subjectIds = [query.subjectId || query.subject_id].filter(Boolean).map(String);
    let assignments: any[] = [];

    const teacherUserId = query.teacherUserId || query.teacher_user_id || (user.role === 'TEACHER' ? user.id : null);
    let teacherId = null;
    if (teacherUserId) {
      const teacherRows: any[] = await this.ds.query(`SELECT id FROM teachers WHERE user_id::text=$1::text OR id::text=$1::text LIMIT 1`, [teacherUserId]);
      teacherId = teacherRows[0]?.id;
      if (!teacherId) {
        return { instituteId, classIds: [], sectionIds: [], subjectIds: [], assignments: [], teacherUserId, teacherId: null, isClassTeacherScope: false };
      }

      assignments = await this.ds.query(
        `SELECT DISTINCT
           ta.class_id::text AS class_id,
           c.name AS class_name,
           ta.section_id::text AS section_id,
           sec.name AS section_name,
           ta.subject_id::text AS subject_id,
           sub.name AS subject_name,
           COALESCE(ta.is_class_teacher, false) AS is_class_teacher
         FROM teacher_academic_assignments ta
         LEFT JOIN classes c ON c.id::text=ta.class_id::text
         LEFT JOIN sections sec ON sec.id::text=ta.section_id::text
         LEFT JOIN subjects sub ON sub.id::text=ta.subject_id::text
         WHERE ta.teacher_id::text=$1::text
         UNION
         SELECT
           sec.class_id::text AS class_id,
           c.name AS class_name,
           sec.id::text AS section_id,
           sec.name AS section_name,
           sub.id::text AS subject_id,
           sub.name AS subject_name,
           true AS is_class_teacher
         FROM sections sec
         LEFT JOIN classes c ON c.id::text=sec.class_id::text
         LEFT JOIN subjects sub
           ON sub.institute_id::text=c.institute_id::text
          AND (
            sub.section_id::text=sec.id::text
            OR (sub.section_id IS NULL AND sub.class_id::text=sec.class_id::text)
          )
         WHERE sec.class_teacher_id::text=$1::text`,
        [teacherId],
      );

      const allAssignments = assignments;
      const classTeacherAssignments = assignments.filter((row) => this.isTrue(row.is_class_teacher));
      const useClassTeacherScope = classTeacherAssignments.length > 0;
      const effectiveAssignments = allAssignments;

      const assignedClassIds = effectiveAssignments.map((row) => row.class_id).filter(Boolean).map(String);
      const assignedSectionIds = effectiveAssignments.map((row) => row.section_id).filter(Boolean).map(String);
      const assignedSubjectIds = useClassTeacherScope
        ? []
        : effectiveAssignments.map((row) => row.subject_id).filter(Boolean).map(String);

      classIds = classIds.length ? classIds.filter((id) => assignedClassIds.includes(id)) : assignedClassIds;
      sectionIds = sectionIds.length ? sectionIds.filter((id) => assignedSectionIds.includes(id)) : assignedSectionIds;
      subjectIds = subjectIds.length
        ? (useClassTeacherScope ? subjectIds : subjectIds.filter((id) => assignedSubjectIds.includes(id)))
        : assignedSubjectIds;

      assignments = allAssignments.map((row) => ({
        ...row,
        is_class_teacher: this.isTrue(row.is_class_teacher),
      }));
    }

    return {
      instituteId,
      classIds: [...new Set(classIds)],
      sectionIds: [...new Set(sectionIds)],
      subjectIds: [...new Set(subjectIds)],
      assignments,
      teacherUserId,
      teacherId,
      isClassTeacherScope: assignments.some((row) => this.isTrue(row.is_class_teacher)),
    };
  }

  async classReport(user: any, query: any) {
    await this.ensureResultSchema();
    const scope = await this.resolveClassScope(user, query);

    // Retroactively sync evaluated submissions from results
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS assessment_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assessment_id UUID NOT NULL,
        student_user_id UUID NOT NULL,
        answer_text TEXT NULL,
        file_path VARCHAR NULL,
        status VARCHAR NOT NULL DEFAULT 'submitted',
        started_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (assessment_id, student_user_id)
      )
    `).catch(() => {});
    await this.ds.query(`
      INSERT INTO assessment_submissions (assessment_id, student_user_id, status)
      SELECT DISTINCT r.assessment_id, r.student_id, 'evaluated'
      FROM results r
      ON CONFLICT (assessment_id, student_user_id) DO UPDATE SET status = 'evaluated'
    `).catch(err => console.error('Failed to sync existing results to assessment_submissions:', err));

    if (scope.teacherUserId && !scope.classIds.length && !scope.sectionIds.length) {
      return {
        success: true,
        data: [],
        students: [],
        weaknesses: [],
        performance: [],
        summary: { classAverage: 0, passRate: 0, atRiskStudents: 0, totalStudents: 0 },
        scope,
      };
    }

    const studentParams: any[] = [scope.instituteId];
    const studentFilters = [`u.institute_id::text=$1::text`, `u.role='STUDENT'`];
    if (scope.classIds.length) {
      studentParams.push(scope.classIds);
      studentFilters.push(`sec.class_id::text = ANY($${studentParams.length}::text[])`);
    }
    if (scope.sectionIds.length) {
      studentParams.push(scope.sectionIds);
      studentFilters.push(`s.section_id::text = ANY($${studentParams.length}::text[])`);
    }

    const students: any[] = await this.ds.query(
      `SELECT
         u.id AS student_id,
         u.name,
         s.roll_no,
         s.enrollment_no,
         s.section_id,
         sec.name AS section_name,
         sec.class_id,
         c.name AS class_name
       FROM users u
       JOIN students s ON s.user_id::text=u.id::text
       LEFT JOIN sections sec ON sec.id::text=s.section_id::text
       LEFT JOIN classes c ON c.id::text=sec.class_id::text
       WHERE ${studentFilters.join(' AND ')}
       ORDER BY c.name NULLS LAST, sec.name NULLS LAST, s.roll_no NULLS LAST, u.name`,
      studentParams,
    );

    if (!students.length) {
      return {
        success: true,
        data: [],
        students: [],
        weaknesses: [],
        performance: [],
        summary: { classAverage: 0, passRate: 0, atRiskStudents: 0, totalStudents: 0 },
        scope,
      };
    }

    const studentIds = students.map((student) => String(student.student_id));
    const resultParams: any[] = [studentIds];
    let resultFilter = '';
    if (scope.classIds.length) {
      resultParams.push(scope.classIds);
      resultFilter += ` AND (a.class_id IS NULL OR a.class_id::text = ANY($${resultParams.length}::text[]))`;
    }
    if (scope.subjectIds.length) {
      resultParams.push(scope.subjectIds);
      resultFilter += ` AND (a.subject_id IS NULL OR a.subject_id::text = ANY($${resultParams.length}::text[]))`;
    }

    const resultRows: any[] = await this.ds.query(
      `SELECT
         r.student_id,
         r.marks_obtained,
         r.total_marks,
         r.percentage,
         r.is_absent,
         r.created_at,
         r.updated_at,
         a.id AS assessment_id,
         a.title,
         a.scheduled_date,
         COALESCE(a.scheduled_date, r.updated_at, r.created_at) AS result_date,
         a.subject_id,
         sub.name AS subject_name
       FROM results r
       INNER JOIN assessment_submissions sub_tbl
          ON sub_tbl.assessment_id::text = r.assessment_id::text
         AND sub_tbl.student_user_id::text = r.student_id::text
       LEFT JOIN assessments a ON a.id::text=r.assessment_id::text
       LEFT JOIN subjects sub ON sub.id::text=a.subject_id::text
       WHERE r.student_id::text = ANY($1::text[])
         AND sub_tbl.status = 'evaluated'${resultFilter}`,
      resultParams,
    );

    const attendanceRows: any[] = await this.ds.query(
      `SELECT
         user_id AS student_id,
         COUNT(*) FILTER (WHERE LOWER(status) IN ('present','late'))::int AS attended,
         COUNT(*)::int AS total
       FROM attendances
       WHERE user_id::text = ANY($1::text[])
       GROUP BY user_id`,
      [studentIds],
    );
    const attendanceByStudent = new Map(attendanceRows.map((row) => [String(row.student_id), row]));

    const resultsByStudent = new Map<string, any[]>();
    const subjectScores = new Map<string, { subject: string; scores: number[]; weakStudents: Set<string> }>();
    const monthScores = new Map<string, { scores: number[]; attendance: number[] }>();
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + index);
      return { key: this.dateKey(day), label: this.dayLabel(day) };
    });
    const dailyScores = new Map<string, number[]>();
    const weeklyStudentScores = new Map<string, number[]>();
    const weeklyAssessmentIds = new Set<string>();

    for (const row of resultRows) {
      const studentId = String(row.student_id);
      const totalMarks = this.toNumber(row.total_marks, 100);
      const percentage = row.percentage !== null && row.percentage !== undefined
        ? this.toNumber(row.percentage)
        : totalMarks ? (this.toNumber(row.marks_obtained) / totalMarks) * 100 : 0;

      if (!resultsByStudent.has(studentId)) resultsByStudent.set(studentId, []);
      resultsByStudent.get(studentId)!.push({ ...row, percentage });

      const subject = row.subject_name || 'General';
      const subjectStat = subjectScores.get(subject) || { subject, scores: [], weakStudents: new Set<string>() };
      subjectStat.scores.push(percentage);
      if (percentage < 50) subjectStat.weakStudents.add(studentId);
      subjectScores.set(subject, subjectStat);

      const month = row.scheduled_date
        ? new Date(row.scheduled_date).toLocaleString('en-US', { month: 'short' })
        : 'Current';
      const monthStat = monthScores.get(month) || { scores: [], attendance: [] };
      monthStat.scores.push(percentage);
      monthScores.set(month, monthStat);

      const resultDate = row.result_date ? new Date(row.result_date) : null;
      if (resultDate && !Number.isNaN(resultDate.getTime()) && resultDate >= weekStart && resultDate <= now) {
        const key = this.dateKey(resultDate);
        dailyScores.set(key, [...(dailyScores.get(key) || []), percentage]);
        weeklyStudentScores.set(studentId, [...(weeklyStudentScores.get(studentId) || []), percentage]);
        if (row.assessment_id) weeklyAssessmentIds.add(String(row.assessment_id));
      }
    }

    const studentPerformance = students.map((student) => {
      const rows = resultsByStudent.get(String(student.student_id)) || [];
      const scores = rows.map((row) => this.toNumber(row.percentage));
      const avgScore = this.average(scores);
      const attendance = attendanceByStudent.get(String(student.student_id));
      const attendanceRate = attendance?.total ? Math.round((this.toNumber(attendance.attended) / this.toNumber(attendance.total)) * 100) : 0;
      const subjectAverages = new Map<string, number[]>();
      for (const row of rows) {
        const subject = row.subject_name || 'General';
        subjectAverages.set(subject, [...(subjectAverages.get(subject) || []), this.toNumber(row.percentage)]);
      }
      const subjects = [...subjectAverages.entries()].map(([subject, values]) => ({ subject, avg: this.average(values) }));
      return {
        id: student.student_id,
        name: student.name,
        enrollmentNo: student.enrollment_no || '-',
        classId: student.class_id || null,
        sectionId: student.section_id || null,
        className: student.class_name || null,
        sectionName: student.section_name || null,
        class: [student.class_name, student.section_name].filter(Boolean).join(' - ') || '-',
        avgScore,
        attendance: attendanceRate,
        isEvaluated: scores.length > 0,
        trend: scores.length > 1 && scores[scores.length - 1] > scores[0] ? 'improving' : scores.length > 1 && scores[scores.length - 1] < scores[0] ? 'declining' : 'consistent',
        weakAreas: subjects.filter((item) => item.avg < 60).map((item) => item.subject),
        strongAreas: subjects.filter((item) => item.avg >= 75).map((item) => item.subject),
      };
    });

    const evaluatedStudents = studentPerformance.filter((student) => (resultsByStudent.get(String(student.id)) || []).length > 0);
    const classAverage = this.average(evaluatedStudents.map((student) => student.avgScore));
    const passRate = evaluatedStudents.length
      ? Math.round((evaluatedStudents.filter((student) => student.avgScore >= 40).length / evaluatedStudents.length) * 100)
      : 0;
    const atRiskStudents = studentPerformance.filter((student) => student.avgScore > 0 && student.avgScore < 40).length;

    const subjectAnalytics = [...subjectScores.values()].map((item) => ({
      subject: item.subject,
      avgScore: this.average(item.scores),
      weakStudents: item.weakStudents.size,
    })).sort((a, b) => b.avgScore - a.avgScore);

    const uniqueClassSections = new Map<string, { classId: string; sectionId: string; className: string; sectionName: string }>();

    if (scope.assignments && scope.assignments.length) {
      for (const row of scope.assignments) {
        const classId = String(row.class_id || row.classId || '');
        const sectionId = String(row.section_id || row.sectionId || '');
        if (classId && sectionId) {
          const key = `${classId}|${sectionId}`;
          if (!uniqueClassSections.has(key)) {
            uniqueClassSections.set(key, {
              classId,
              sectionId,
              className: row.class_name || row.className || 'Assigned Class',
              sectionName: row.section_name || row.sectionName || '',
            });
          }
        }
      }
    }

    for (const student of studentPerformance) {
      const classId = String(student.classId || '');
      const sectionId = String(student.sectionId || '');
      if (classId && sectionId) {
        const key = `${classId}|${sectionId}`;
        if (!uniqueClassSections.has(key)) {
          uniqueClassSections.set(key, {
            classId,
            sectionId,
            className: student.className || 'Assigned Class',
            sectionName: student.sectionName || '',
          });
        }
      }
    }

    const classAnalytics = Array.from(uniqueClassSections.values()).map((cs) => {
      const classStudents = studentPerformance.filter(
        (s) => String(s.classId || '') === cs.classId && String(s.sectionId || '') === cs.sectionId
      );
      const classEvaluated = classStudents.filter((s) => (resultsByStudent.get(String(s.id)) || []).length > 0);
      const avgScore = classEvaluated.length ? this.average(classEvaluated.map((s) => s.avgScore)) : 0;
      const passRate = classEvaluated.length
        ? Math.round((classEvaluated.filter((s) => s.avgScore >= 40).length / classEvaluated.length) * 100)
        : 0;
      const attendance = this.average(classStudents.map((s) => s.attendance).filter((value) => value > 0));

      const classSubjectScores = new Map<string, number[]>();
      for (const student of classStudents) {
        const studentResults = resultsByStudent.get(String(student.id)) || [];
        for (const row of studentResults) {
          const subject = row.subject_name || 'General';
          if (!classSubjectScores.has(subject)) {
            classSubjectScores.set(subject, []);
          }
          classSubjectScores.get(subject)!.push(row.percentage);
        }
      }

      const classSubjectAnalytics = [...classSubjectScores.entries()].map(([subject, scores]) => ({
        subject,
        avgScore: this.average(scores),
      })).sort((a, b) => b.avgScore - a.avgScore);

      const topSubject = classSubjectAnalytics[0]?.subject || '-';
      const weakSubject = classSubjectAnalytics[classSubjectAnalytics.length - 1]?.subject || '-';

      const classLabel = [cs.className, cs.sectionName].filter(Boolean).join(' - ') || 'Assigned Class';

      return {
        class: classLabel,
        totalEvaluated: classEvaluated.length,
        avgScore,
        passRate,
        topSubject,
        weakSubject,
        attendance,
      };
    });

    const weaknesses = subjectAnalytics
      .filter((item) => item.weakStudents > 0 || item.avgScore < 60)
      .map((item) => ({ topic: item.subject, weakStudents: item.weakStudents, avgScore: item.avgScore }));

    const overallAttendance = this.average(studentPerformance.map((student) => student.attendance).filter((value) => value > 0));

    const performance = [...monthScores.entries()].map(([month, item]) => ({
      month,
      avgScore: this.average(item.scores),
      attendance: classAnalytics[0]?.attendance || overallAttendance || 0,
    }));
    const weeklyAverages = [...weeklyStudentScores.values()].map((scores) => this.average(scores));
    const weeklyAverage = this.average(weeklyAverages);
    const weeklyAnalysis = {
      averageScore: weeklyAverage,
      passRate: weeklyAverages.length
        ? Math.round((weeklyAverages.filter((score) => score >= 40).length / weeklyAverages.length) * 100)
        : 0,
      atRiskStudents: weeklyAverages.filter((score) => score > 0 && score < 40).length,
      evaluatedStudents: weeklyAverages.length,
      totalStudents: studentPerformance.length,
      assessments: weeklyAssessmentIds.size,
      days: weekDays.map((day) => ({
        day: day.label,
        date: day.key,
        avgScore: this.average(dailyScores.get(day.key) || []),
        tests: (dailyScores.get(day.key) || []).length,
      })),
    };

    // Calculate dynamic performance stats from evaluated student submissions
    let totalAssessmentsCreated = 0;
    let totalStudentSubmissions = 0;
    let evaluatedSubmissions = 0;
    let pendingEvaluations = 0;
    let averageStudentScore = 0;
    let averageAccuracy = 0;
    let highestScore = 0;
    let lowestScore = 0;

    let assessmentsToQuery: any[] = [];
    if (scope.teacherUserId || scope.teacherId) {
      const tUserId = scope.teacherUserId;
      const tId = scope.teacherId;

      let assessmentsQuery = `SELECT id, total_marks FROM assessments WHERE (teacher_id::text = $1::text OR teacher_id::text = $2::text)`;
      const assessmentsParams: any[] = [tUserId, tId];

      if (scope.classIds && scope.classIds.length) {
        assessmentsParams.push(scope.classIds);
        assessmentsQuery += ` OR (class_id::text = ANY($${assessmentsParams.length}::text[])`;
        if (scope.subjectIds && scope.subjectIds.length) {
          assessmentsParams.push(scope.subjectIds);
          assessmentsQuery += ` AND subject_id::text = ANY($${assessmentsParams.length}::text[])`;
        }
        assessmentsQuery += `)`;
      }

      assessmentsToQuery = await this.ds.query(assessmentsQuery, assessmentsParams).catch(() => []);
    } else {
      let assessmentsQuery = `SELECT id, total_marks FROM assessments WHERE 1=1`;
      const assessmentsParams: any[] = [];
      if (scope.classIds && scope.classIds.length) {
        assessmentsParams.push(scope.classIds);
        assessmentsQuery += ` AND class_id::text = ANY($${assessmentsParams.length}::text[])`;
      }
      if (scope.subjectIds && scope.subjectIds.length) {
        assessmentsParams.push(scope.subjectIds);
        assessmentsQuery += ` AND subject_id::text = ANY($${assessmentsParams.length}::text[])`;
      }
      assessmentsToQuery = await this.ds.query(assessmentsQuery, assessmentsParams).catch(() => []);
    }

    totalAssessmentsCreated = assessmentsToQuery.length;

    if (totalAssessmentsCreated > 0) {
      const tAssessmentIds = assessmentsToQuery.map((a: any) => String(a.id));

      const subRows = await this.ds.query(
        `SELECT id, assessment_id, student_user_id, status FROM assessment_submissions WHERE assessment_id::text = ANY($1::text[]) AND student_user_id::text = ANY($2::text[])`,
        [tAssessmentIds, studentIds]
      ).catch(() => []);

      const resRows = await this.ds.query(
        `SELECT r.id, r.assessment_id, r.student_id, r.percentage, r.marks_obtained, r.total_marks, r.is_absent 
         FROM results r
         INNER JOIN assessment_submissions s 
            ON s.assessment_id::text = r.assessment_id::text 
           AND s.student_user_id::text = r.student_id::text
         WHERE r.assessment_id::text = ANY($1::text[])
           AND r.student_id::text = ANY($2::text[])
           AND s.status = 'evaluated'`,
        [tAssessmentIds, studentIds]
      ).catch(() => []);

      evaluatedSubmissions = subRows.filter((sub: any) => sub.status === 'evaluated').length;

      pendingEvaluations = subRows.filter((sub: any) => 
        (sub.status === 'submitted' || sub.status === 'auto_submitted') &&
        !resRows.some((r: any) => String(r.assessment_id) === String(sub.assessment_id) && String(r.student_id) === String(sub.student_user_id))
      ).length;

      totalStudentSubmissions = evaluatedSubmissions + pendingEvaluations;

      const validResults = resRows.filter((r: any) => !r.is_absent);
      if (validResults.length > 0) {
        const percentages = validResults.map((r: any) => {
          const totalMarks = this.toNumber(r.total_marks, 100);
          return r.percentage !== null && r.percentage !== undefined
            ? this.toNumber(r.percentage)
            : totalMarks ? (this.toNumber(r.marks_obtained) / totalMarks) * 100 : 0;
        });

        const totalPercentage = percentages.reduce((sum, p) => sum + p, 0);
        averageStudentScore = Math.round(totalPercentage / percentages.length);
        averageAccuracy = averageStudentScore;
        highestScore = Math.round(Math.max(...percentages));
        lowestScore = Math.round(Math.min(...percentages));
      }
    }

    console.log('[DEBUG classReport] query:', query, 'classAnalytics:', classAnalytics);
    console.log(`[Teacher Performance Audit] Teacher ID: ${scope.teacherId || 'N/A'}, Assessments: ${totalAssessmentsCreated}, Submissions: ${totalStudentSubmissions}, Evaluated: ${evaluatedSubmissions}, Distinct Students: ${evaluatedStudents.length}`);
    return {
      success: true,
      data: classAnalytics,
      students: studentPerformance,
      weaknesses,
      performance,
      weeklyAnalysis,
      summary: {
        classAverage: classAverage || averageStudentScore || 0,
        passRate,
        atRiskStudents,
        totalStudents: studentPerformance.length,
        totalAssessmentsCreated,
        totalStudentSubmissions,
        evaluatedSubmissions,
        pendingEvaluations,
        averageStudentScore: averageStudentScore || classAverage || 0,
        averageAccuracy: averageAccuracy || classAverage || 0,
        highestScore,
        lowestScore,
      },
      scope,
    };
  }

  async myStudentAnalytics(user: any) {
    await this.ensureResultSchema();
    const profileRows: any[] = await this.ds.query(
      `SELECT
         s.user_id,
         s.section_id,
         sec.class_id,
         c.name AS class_name,
         sec.name AS section_name
       FROM students s
       LEFT JOIN sections sec ON sec.id::text=s.section_id::text
       LEFT JOIN classes c ON c.id::text=sec.class_id::text
       WHERE s.user_id::text=$1::text
       LIMIT 1`,
      [user.id],
    );
    const profile = profileRows[0] || null;

    const resultRows: any[] = await this.ds.query(
      `SELECT
         r.id,
         r.assessment_id,
         r.student_id,
         r.marks_obtained,
         r.total_marks,
         r.percentage,
         r.is_absent,
         r.grade,
         r.remarks,
         r.created_at,
         r.updated_at,
         a.title AS assessment_title,
         a.scheduled_date,
         a.subject_id,
         sub.name AS subject_name
       FROM results r
       LEFT JOIN assessments a ON a.id::text=r.assessment_id::text
       LEFT JOIN subjects sub ON sub.id::text=a.subject_id::text
       WHERE r.student_id::text=$1::text
       ORDER BY COALESCE(a.scheduled_date, r.updated_at, r.created_at) ASC`,
      [user.id],
    );

    const submissionRows: any[] = await this.ds.query(
      `SELECT assessment_id, submitted_at
       FROM assessment_submissions
       WHERE student_user_id::text=$1::text
       ORDER BY submitted_at ASC`,
      [user.id],
    ).catch(() => []);

    const scores = resultRows
      .filter((row) => !row.is_absent)
      .map((row) => {
        const totalMarks = this.toNumber(row.total_marks, 100);
        return row.percentage !== null && row.percentage !== undefined
          ? this.toNumber(row.percentage)
          : totalMarks ? (this.toNumber(row.marks_obtained) / totalMarks) * 100 : 0;
      });

    const subjectMap = new Map<string, number[]>();
    resultRows.forEach((row) => {
      if (row.is_absent) return;
      const subject = row.subject_name || 'General';
      const totalMarks = this.toNumber(row.total_marks, 100);
      const percentage = row.percentage !== null && row.percentage !== undefined
        ? this.toNumber(row.percentage)
        : totalMarks ? (this.toNumber(row.marks_obtained) / totalMarks) * 100 : 0;
      subjectMap.set(subject, [...(subjectMap.get(subject) || []), percentage]);
    });

    const subjectPerformance = [...subjectMap.entries()]
      .map(([subjectName, values]) => ({
        subjectName,
        accuracy: this.average(values),
        attempts: values.length,
      }))
      .sort((a, b) => b.accuracy - a.accuracy);

    const weakTopics = subjectPerformance
      .filter((subject) => subject.accuracy < 60)
      .map((subject) => ({
        name: subject.subjectName,
        subjectName: subject.subjectName,
        accuracy: subject.accuracy,
      }));

    const activityDates = [
      ...resultRows.map((row) => row.updated_at || row.created_at || row.scheduled_date).filter(Boolean),
      ...submissionRows.map((row) => row.submitted_at).filter(Boolean),
    ].map((date) => new Date(date).toISOString().slice(0, 10));
    const uniqueActivityDates = [...new Set(activityDates)].sort();
    let streakDays = 0;
    if (uniqueActivityDates.length) {
      streakDays = 1;
      for (let i = uniqueActivityDates.length - 1; i > 0; i -= 1) {
        const current = new Date(uniqueActivityDates[i]);
        const previous = new Date(uniqueActivityDates[i - 1]);
        const diffDays = Math.round((current.getTime() - previous.getTime()) / 86400000);
        if (diffDays === 1) streakDays += 1;
        else if (diffDays > 1) break;
      }
    }

    const overallAccuracy = this.average(scores);
    const questionsAttempted = resultRows.length;
    const strongSubject = subjectPerformance[0]?.subjectName || null;
    const focusSubject = weakTopics[0]?.subjectName || null;
    const summary = questionsAttempted
      ? focusSubject
        ? `Your overall score is ${overallAccuracy}%. ${strongSubject ? `${strongSubject} is your strongest area. ` : ''}Focus next on ${focusSubject} to improve your average.`
        : `Your overall score is ${overallAccuracy}%. No weak subject is currently flagged, so keep practicing consistently.`
      : 'Complete assessments and wait for published results to generate personalized insights.';

    return {
      success: true,
      data: {
        profile,
        overallAccuracy,
        questionsAttempted,
        totalTimeSpentSeconds: 0,
        streakDays,
        subjectPerformance,
        weakTopics,
        recentResults: resultRows.slice(-8).reverse().map((row) => ({
          id: row.id,
          assessmentTitle: row.assessment_title,
          subjectName: row.subject_name || 'General',
          marksObtained: this.toNumber(row.marks_obtained),
          totalMarks: this.toNumber(row.total_marks, 100),
          percentage: row.percentage !== null && row.percentage !== undefined ? this.toNumber(row.percentage) : 0,
          grade: row.grade,
          remarks: row.remarks,
          isAbsent: row.is_absent,
        })),
        insights: { summary },
      },
    };
  }

  async studentReport(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    let filter = `u.institute_id=$1 AND u.role='STUDENT'`;
    const params: any[] = [instituteId];

    if (query.search) {
      const searchTerms = query.search.trim().split(' ').filter(Boolean).map((term: string) => `%${term.toLowerCase()}%`);
      if (searchTerms.length > 0) {
        const searchConditions = searchTerms.map((term: string) => {
          params.push(term);
          return `(LOWER(u.name) LIKE $${params.length} OR LOWER(s.enrollment_no) LIKE $${params.length})`;
        });
        filter += ` AND (${searchConditions.join(' AND ')})`;
      }
    }

    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM users u
      JOIN students s ON s.user_id=u.id
      LEFT JOIN sections sec ON s.section_id=sec.id
      LEFT JOIN classes c ON sec.class_id=c.id
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const allowedSortFields: Record<string, string> = {
      name: 'u.name',
      enrollmentNo: 's.enrollment_no',
    };
    const sortBy = allowedSortFields[query.sortBy] || 'u.name';
    const sortOrder = query.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const sql = `
      SELECT u.id,u.name,u.email,u.phone,u.is_active,
              s.enrollment_no,s.roll_no,s.gender,s.dob,s.admission_date,
              sec.name AS section_name,c.name AS class_name,
              COUNT(ar.id)::int AS total_sessions,
              COUNT(ar.id) FILTER (WHERE ar.status='present' OR ar.status='late')::int AS present_count,
              COUNT(ar.id) FILTER (WHERE ar.status='absent')::int AS absent_count
       FROM users u
       JOIN students s ON s.user_id=u.id
       LEFT JOIN sections sec ON s.section_id=sec.id
       LEFT JOIN classes c ON sec.class_id=c.id
       LEFT JOIN attendance_records ar ON ar.student_id=u.id
       WHERE ${filter}
       GROUP BY u.id,u.name,u.email,u.phone,u.is_active,s.enrollment_no,s.roll_no,s.gender,s.dob,s.admission_date,sec.name,c.name
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT ${limit} OFFSET ${offset}
    `;

    const rows: any[] = await this.ds.query(sql, params);
    return { success: true, count: rows.length, data: rows, total, page, limit, totalPages };
  }

  async assessmentReport(user: any, query: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? (query.instituteId || user.instituteId) : user.instituteId;
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 100);
    const offset = (page - 1) * limit;

    const [countResult, rows] = await Promise.all([
      this.ds.query(
        `SELECT COUNT(*)::int AS total
         FROM assessments a
         LEFT JOIN results r ON r.assessment_id=a.id
         WHERE a.institute_id=$1`,
        [instituteId],
      ),
      this.ds.query(
        `SELECT a.id AS assessment_id,a.title,a.assessment_type,a.total_marks,a.passing_marks,a.scheduled_at,a.status,
                sub.name AS subject_name,
                u.id AS student_id,u.name AS student_name,
                r.marks_obtained,r.is_absent,r.grade,r.remarks
         FROM assessments a
         LEFT JOIN subjects sub ON a.subject_id=sub.id
         LEFT JOIN results r ON r.assessment_id=a.id
         LEFT JOIN users u ON r.student_id=u.id
         WHERE a.institute_id=$1
         ORDER BY a.scheduled_at DESC NULLS LAST, u.name
         LIMIT $2 OFFSET $3`,
        [instituteId, limit, offset],
      ),
    ]);
    const total = countResult[0]?.total ?? 0;
    return { success: true, count: rows.length, data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async teacherClassReport(user: any, query: any) {
    const instituteId = user.instituteId;
    const classId = query.classId || null;
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const offset = (page - 1) * limit;

    let filter = `u.institute_id=$1 AND u.role='STUDENT'`;
    const params: any[] = [instituteId];

    if (classId) {
      params.push(classId);
      filter += ` AND c.id=$${params.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM users u
      JOIN students s ON s.user_id=u.id
      LEFT JOIN sections sec ON s.section_id=sec.id
      LEFT JOIN classes c ON sec.class_id=c.id
      WHERE ${filter}
    `;
    const countResult = await this.ds.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);
    const totalPages = Math.ceil(total / limit);

    const studentsSql = `
      SELECT u.id,u.name,c.name AS class_name
      FROM users u
      JOIN students s ON s.user_id=u.id
      LEFT JOIN sections sec ON s.section_id=sec.id
      LEFT JOIN classes c ON sec.class_id=c.id
      WHERE ${filter}
      ORDER BY u.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const studentsRows = await this.ds.query(studentsSql, params);

    const studentsData = studentsRows.map((s: any) => {
      // Mock student performance for UI
      const avgScore = Math.floor(Math.random() * 30) + 65;
      const trends = ['improving', 'declining', 'stable'];
      return {
        id: s.id,
        name: s.name,
        class: s.class_name || 'N/A',
        avgScore,
        trend: trends[Math.floor(Math.random() * trends.length)],
        weakAreas: ['Mathematics', 'Physics'].slice(0, Math.floor(Math.random() * 2) + 1),
        strongAreas: ['English', 'Biology'].slice(0, Math.floor(Math.random() * 2) + 1)
      };
    });

    const mockData = [
      { title: 'Jan', class_name: 'Class 9', avg_score: 75, attendance_rate: 92, pass_rate: 85, top_subject: 'English', weak_subject: 'Math' },
      { title: 'Feb', class_name: 'Class 9', avg_score: 78, attendance_rate: 94, pass_rate: 88, top_subject: 'Science', weak_subject: 'Math' },
      { title: 'Mar', class_name: 'Class 9', avg_score: 82, attendance_rate: 90, pass_rate: 92, top_subject: 'History', weak_subject: 'Physics' },
    ];

    const mockWeaknesses = [
      { topic: 'Algebra', weak_students: 12, avg_score: 45 },
      { topic: 'Thermodynamics', weak_students: 8, avg_score: 52 },
      { topic: 'Trigonometry', weak_students: 15, avg_score: 41 },
    ];

    return {
      success: true,
      data: mockData,
      students: studentsData,
      weaknesses: mockWeaknesses,
      total,
      page,
      limit,
      totalPages
    };
  }
}
