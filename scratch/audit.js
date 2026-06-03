const { Client } = require('pg');
const connectionString = process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

const client = new Client({ connectionString });

async function runAudit() {
  await client.connect();
  const results = {};

  const query = async (name, sql) => {
    try {
      const res = await client.query(sql);
      results[name] = { sql, data: res.rows };
    } catch (e) {
      results[name] = { sql, error: e.message };
    }
  };

  // 1. Total records
  await query('total_records', `
    SELECT 'subjects' as table, COUNT(*) as count FROM subjects UNION ALL
    SELECT 'chapters', COUNT(*) FROM chapters UNION ALL
    SELECT 'topics', COUNT(*) FROM topics UNION ALL
    SELECT 'study_materials', COUNT(*) FROM study_materials UNION ALL
    SELECT 'presentations', COUNT(*) FROM presentations UNION ALL
    SELECT 'mind_maps', COUNT(*) FROM mind_maps
  `);

  // 2. Orphaned records & 5. Invalid foreign keys
  await query('orphaned_subjects_class', 'SELECT id, name FROM subjects WHERE class_id IS NOT NULL AND class_id NOT IN (SELECT id FROM classes)');
  await query('orphaned_subjects_section', 'SELECT id, name FROM subjects WHERE section_id IS NOT NULL AND section_id NOT IN (SELECT id FROM sections)');
  
  // Note: chapters -> subject_id
  await query('orphaned_chapters', 'SELECT id, name FROM chapters WHERE subject_id IS NOT NULL AND subject_id NOT IN (SELECT id FROM subjects)');
  
  // Note: topics -> chapter_id
  await query('orphaned_topics', 'SELECT id, name FROM topics WHERE chapter_id IS NOT NULL AND chapter_id NOT IN (SELECT id FROM chapters)');

  // 3. Duplicate records
  await query('duplicate_subjects', 'SELECT name, class_id, section_id, COUNT(*) as count FROM subjects GROUP BY name, class_id, section_id HAVING COUNT(*) > 1');
  await query('duplicate_chapters', 'SELECT name, subject_id, COUNT(*) as count FROM chapters GROUP BY name, subject_id HAVING COUNT(*) > 1');
  await query('duplicate_topics', 'SELECT name, chapter_id, COUNT(*) as count FROM topics GROUP BY name, chapter_id HAVING COUNT(*) > 1');
  await query('duplicate_materials', 'SELECT title, tenant_id, COUNT(*) as count FROM study_materials GROUP BY title, tenant_id HAVING COUNT(*) > 1');

  // 4. Missing relationships / 6. Null values
  await query('null_class_subjects', 'SELECT COUNT(*) as count FROM subjects WHERE class_id IS NULL');
  await query('null_subject_chapters', 'SELECT COUNT(*) as count FROM chapters WHERE subject_id IS NULL');
  await query('null_chapter_topics', 'SELECT COUNT(*) as count FROM topics WHERE chapter_id IS NULL');

  console.log(JSON.stringify(results, null, 2));

  await client.end();
}

runAudit().catch(console.error);
