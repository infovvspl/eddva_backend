import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SchoolReportService {
  private resultSchemaReady = false;

  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

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
    if (teacherUserId) {
      const teacherRows: any[] = await this.ds.query(`SELECT id FROM teachers WHERE user_id::text=$1::text LIMIT 1`, [teacherUserId]);
      const teacherId = teacherRows[0]?.id;
      if (!teacherId) {
        return { instituteId, classIds: [], sectionIds: [], subjectIds: [], assignments: [], teacherUserId, isClassTeacherScope: false };
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
      isClassTeacherScope: assignments.some((row) => this.isTrue(row.is_class_teacher)),
    };
  }

  async classReport(user: any, query: any) {
    await this.ensureResultSchema();
    const scope = await this.resolveClassScope(user, query);

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
       LEFT JOIN assessments a ON a.id::text=r.assessment_id::text
       LEFT JOIN subjects sub ON sub.id::text=a.subject_id::text
       WHERE r.student_id::text = ANY($1::text[])${resultFilter}`,
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

    const firstStudent = students[0];
    const classAnalytics = [{
      class: [firstStudent?.class_name, firstStudent?.section_name].filter(Boolean).join(' - ') || 'Assigned Classes',
      avgScore: classAverage,
      passRate,
      topSubject: subjectAnalytics[0]?.subject || '-',
      weakSubject: subjectAnalytics[subjectAnalytics.length - 1]?.subject || '-',
      attendance: this.average(studentPerformance.map((student) => student.attendance).filter((value) => value > 0)),
    }];

    const weaknesses = subjectAnalytics
      .filter((item) => item.weakStudents > 0 || item.avgScore < 60)
      .map((item) => ({ topic: item.subject, weakStudents: item.weakStudents, avgScore: item.avgScore }));

    const performance = [...monthScores.entries()].map(([month, item]) => ({
      month,
      avgScore: this.average(item.scores),
      attendance: classAnalytics[0].attendance,
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

    return {
      success: true,
      data: classAnalytics,
      students: studentPerformance,
      weaknesses,
      performance,
      weeklyAnalysis,
      summary: {
        classAverage,
        passRate,
        atRiskStudents,
        totalStudents: studentPerformance.length,
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
    const rows: any[] = await this.ds.query(
      `SELECT a.id AS assessment_id,a.title,a.assessment_type,a.total_marks,a.passing_marks,a.scheduled_at,a.status,
              sub.name AS subject_name,
              u.id AS student_id,u.name AS student_name,
              r.marks_obtained,r.is_absent,r.grade,r.remarks
       FROM assessments a
       LEFT JOIN subjects sub ON a.subject_id=sub.id
       LEFT JOIN results r ON r.assessment_id=a.id
       LEFT JOIN users u ON r.student_id=u.id
       WHERE a.institute_id=$1
       ORDER BY a.scheduled_at DESC NULLS LAST, u.name`,
      [instituteId],
    );
    return { success: true, count: rows.length, data: rows };
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
