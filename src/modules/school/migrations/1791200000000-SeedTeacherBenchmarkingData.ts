import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds AI-analysed class recordings (Jun-Oct 2026) for one teacher so the
 * Teacher Profile -> Benchmarking tab has data to roll up. The target teacher
 * is resolved by email (primary, then fallback); if neither exists the
 * migration is a no-op. Seeded rows are tagged with
 * video_key = 'seed:teacher-benchmarking' so down() removes exactly them.
 */
const TAG = 'seed:teacher-benchmarking';
const EMAILS = ['pratdas78488@gmail.com', 'pratap.das@gmail.com'];

const SESSIONS: Array<[string, string, number, number, number, number, number, number]> = [
  // date, title, overall, clarity, pacing, coverage, engagement, language
  ['2026-06-10', 'Introduction to Algebraic Expressions', 6.4, 6.5, 5.8, 6.8, 6.0, 7.0],
  ['2026-06-24', 'Linear Equations in One Variable', 6.7, 6.9, 6.1, 7.0, 6.3, 7.1],
  ['2026-07-15', 'Quadratic Equations: Factorisation', 7.0, 7.2, 6.5, 7.3, 6.8, 7.3],
  ['2026-08-05', 'Coordinate Geometry Basics', 7.3, 7.5, 7.0, 7.4, 7.1, 7.5],
  ['2026-08-26', 'Triangles and Congruence', 7.6, 7.8, 7.2, 7.8, 7.5, 7.7],
  ['2026-09-12', 'Introduction to Trigonometry', 7.9, 8.1, 7.6, 8.0, 7.8, 7.9],
  ['2026-09-26', 'Statistics: Mean, Median and Mode', 8.2, 8.3, 7.9, 8.4, 8.1, 8.2],
  ['2026-10-06', 'Probability: Revision Class', 8.4, 8.6, 8.1, 8.5, 8.4, 8.3],
];

const STRENGTHS = [
  'Explains concepts with clear step-by-step worked examples',
  'Uses everyday examples that connect topics to real life',
  'Maintains a calm, encouraging tone that keeps students comfortable asking questions',
  'Recaps key points at the end of each segment',
];
const SUGGESTIONS = [
  'Pause more often to check understanding before moving to the next concept',
  'Add a short interactive question or poll every 10 minutes to raise engagement',
  'Slow the pace slightly during multi-step derivations',
  'Use more visual aids or diagrams for abstract topics',
];

const rubric = (score: number, feedback: string) => ({ score, feedback });

export class SeedTeacherBenchmarkingData1791200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS ai_teaching_analysis JSONB`);
    await queryRunner.query(`ALTER TABLE class_recordings ADD COLUMN IF NOT EXISTS ai_teaching_analysis_status VARCHAR(16)`);

    let teacher: { id: string; institute_id: string } | undefined;
    for (const email of EMAILS) {
      const rows = await queryRunner.query(
        `SELECT u.id::text AS id, u.institute_id::text AS institute_id
           FROM users u JOIN teachers t ON t.user_id = u.id
          WHERE LOWER(u.email) = LOWER($1) LIMIT 1`,
        [email],
      );
      if (rows.length) { teacher = rows[0]; break; }
    }
    if (!teacher) return;

    const already = await queryRunner.query(
      `SELECT 1 FROM class_recordings WHERE teacher_user_id::text = $1 AND video_key LIKE $2 LIMIT 1`,
      [teacher.id, `${TAG}%`],
    );
    if (already.length) return;

    for (const [date, title, overall, clarity, pacing, coverage, engagement, language] of SESSIONS) {
      // Weakest dimensions surface the matching improvement suggestions.
      const analysis = {
        overallScore: overall,
        summary: `${title}: well-structured lesson with ${overall >= 8 ? 'strong' : 'steadily improving'} student engagement.`,
        clarity: rubric(clarity, 'Concepts are explained in a logical order with worked examples.'),
        pacing: rubric(pacing, pacing < 7 ? 'Pace is a little fast in multi-step sections.' : 'Pace is well matched to the class.'),
        contentCoverage: rubric(coverage, 'Syllabus points for the topic are covered in full.'),
        studentEngagement: rubric(engagement, engagement < 7 ? 'Few opportunities for students to respond.' : 'Good use of questions to involve students.'),
        languageQuality: rubric(language, 'Clear, simple language suited to the grade.'),
        strengths: STRENGTHS.slice(0, 3),
        suggestions: SUGGESTIONS.slice(0, overall < 7.5 ? 4 : 2),
      };
      await queryRunner.query(
        `INSERT INTO class_recordings
           (institute_id, teacher_user_id, title, description, video_url, video_key, recorded_date, duration, views,
            ai_teaching_analysis, ai_teaching_analysis_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10::jsonb, 'done')`,
        [
          teacher.institute_id, teacher.id, title, 'Recorded class session',
          `seed://teacher-benchmarking/${date}`, `${TAG}:${date}`, date, '45:00', 20 + Math.round(overall * 4),
          JSON.stringify(analysis),
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM class_recordings WHERE video_key LIKE $1`, [`${TAG}%`]);
  }
}
