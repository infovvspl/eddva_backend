import { MigrationInterface, QueryRunner } from 'typeorm';

function normalizeSubjectName(name: string): string {
  if (!name) return '';
  const cleaned = name.trim().replace(/\s+/g, ' ');
  const lowerCleaned = cleaned.toLowerCase();
  
  if (lowerCleaned === 'math' || lowerCleaned === 'maths' || lowerCleaned === 'mathematics') {
    return 'Mathematics';
  }
  if (lowerCleaned === 'hindi') {
    return 'Hindi';
  }
  if (lowerCleaned === 'english') {
    return 'English';
  }
  if (lowerCleaned === 'science') {
    return 'Science';
  }
  if (lowerCleaned === 'biology') {
    return 'Biology';
  }
  if (lowerCleaned === 'computer science') {
    return 'Computer Science';
  }
  if (lowerCleaned === 'social science') {
    return 'Social Science';
  }
  if (lowerCleaned === 'history') {
    return 'History';
  }
  
  // Title case general words
  return cleaned
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export class CleanupSubjectsAndTimetables1780600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Fetch all subjects
    const subjects = await queryRunner.query(`
      SELECT id, institute_id, class_id, section_id, name 
      FROM subjects
    `);

    // Group subjects by scope and normalized name
    // Scope: institute_id + class_id + section_id + normalized_name
    const groups: Record<string, any[]> = {};
    for (const sub of subjects) {
      const normName = normalizeSubjectName(sub.name);
      const classIdStr = sub.class_id || 'null';
      const sectionIdStr = sub.section_id || 'null';
      const key = `${sub.institute_id}_${classIdStr}_${sectionIdStr}_${normName.toLowerCase()}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push({ ...sub, normName });
    }

    const tablesToUpdate = [
      { table: 'teacher_academic_assignments', column: 'subject_id' },
      { table: 'timetables', column: 'subject_id' },
      { table: 'assignments', column: 'subject_id' },
      { table: 'assessments', column: 'subject_id' },
      { table: 'study_materials', column: 'subject_id_fk' },
      { table: 'chapters', column: 'subject_id' },
      { table: 'class_recordings', column: 'subject_id' },
      { table: 'class_subjects', column: 'subject_id' },
      { table: 'mock_tests', column: 'subject_id' },
      { table: 'schedules', column: 'subject_id' },
      { table: 'school_game_sessions', column: 'subject_id' },
      { table: 'student_doubts', column: 'subject_id' },
      { table: 'teacher_subjects', column: 'subject_id' },
      { table: 'attendance_sessions', column: 'subject_id' },
    ];

    const checkAndMap = async (table: string, column: string, canonicalId: string, duplicateId: string) => {
      const colCheck = await queryRunner.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = $2
      `, [table, column]);
      
      if (colCheck.length > 0) {
        if (table === 'class_subjects') {
          await queryRunner.query(`
            DELETE FROM class_subjects
            WHERE subject_id::text = $1::text
              AND class_id IN (
                SELECT class_id FROM class_subjects WHERE subject_id::text = $2::text
              )
          `, [duplicateId, canonicalId]);
        } else if (table === 'teacher_subjects') {
          await queryRunner.query(`
            DELETE FROM teacher_subjects
            WHERE subject_id::text = $1::text
              AND (teacher_id, COALESCE(section_id::text, '')) IN (
                SELECT teacher_id, COALESCE(section_id::text, '') FROM teacher_subjects WHERE subject_id::text = $2::text
              )
          `, [duplicateId, canonicalId]);
        } else if (table === 'teacher_academic_assignments') {
          await queryRunner.query(`
            UPDATE teacher_academic_assignments
            SET is_class_teacher = true
            WHERE subject_id::text = $1::text
              AND is_class_teacher = false
              AND (teacher_id, class_id, section_id) IN (
                SELECT teacher_id, class_id, section_id 
                FROM teacher_academic_assignments 
                WHERE subject_id::text = $2::text AND is_class_teacher = true
              )
          `, [canonicalId, duplicateId]);
          
          await queryRunner.query(`
            DELETE FROM teacher_academic_assignments
            WHERE subject_id::text = $1::text
              AND (teacher_id, class_id, section_id) IN (
                SELECT teacher_id, class_id, section_id FROM teacher_academic_assignments WHERE subject_id::text = $2::text
              )
          `, [duplicateId, canonicalId]);
        }
        
        await queryRunner.query(`
          UPDATE ${table} 
          SET ${column} = $1 
          WHERE ${column}::text = $2::text
        `, [canonicalId, duplicateId]);
      }
    };

    // Perform merges and updates
    for (const key of Object.keys(groups)) {
      const group = groups[key];
      
      // Select canonical subject
      let canonical = group[0];
      for (const s of group) {
        if (s.name === s.normName) {
          canonical = s;
          break;
        }
      }
      
      const canonicalId = canonical.id;
      const normalizedName = canonical.normName;

      // Update canonical subject name to normalized Title Case name
      await queryRunner.query(`
        UPDATE subjects 
        SET name = $1 
        WHERE id = $2
      `, [normalizedName, canonicalId]);

      // Map other duplicate subjects to canonical and delete them
      for (const dup of group) {
        if (dup.id === canonicalId) continue;
        
        const duplicateId = dup.id;
        for (const target of tablesToUpdate) {
          await checkAndMap(target.table, target.column, canonicalId, duplicateId);
        }

        // Delete duplicate subject record
        await queryRunner.query(`
          DELETE FROM subjects 
          WHERE id::text = $1::text
        `, [duplicateId]);
      }
    }

    // Finally, standardize name for all remaining subjects just in case
    const remainingSubjects = await queryRunner.query(`SELECT id, name FROM subjects`);
    for (const sub of remainingSubjects) {
      const normalized = normalizeSubjectName(sub.name);
      if (sub.name !== normalized) {
        await queryRunner.query(`
          UPDATE subjects 
          SET name = $1 
          WHERE id = $2
        `, [normalized, sub.id]);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Migration is one-way cleanup of duplicates and normalization
  }
}
