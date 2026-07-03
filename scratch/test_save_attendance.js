const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  // Find a class and section to test with
  const classRes = await client.query('SELECT id FROM classes LIMIT 1');
  const sectionRes = await client.query('SELECT id FROM sections LIMIT 1');
  
  if (classRes.rows.length === 0 || sectionRes.rows.length === 0) {
    console.log('No class or section found in DB');
    await client.end();
    return;
  }

  const classId = classRes.rows[0].id;
  const sectionId = sectionRes.rows[0].id;

  // Let's find some students in this class/section
  const studentRes = await client.query(`
    SELECT u.id 
    FROM users u 
    JOIN students s ON s.user_id = u.id 
    WHERE s.section_id = $1 
    LIMIT 10
  `, [sectionId]);

  console.log(`Found ${studentRes.rows.length} students in section ${sectionId}`);
  if (studentRes.rows.length === 0) {
    console.log('No students found in this section');
    await client.end();
    return;
  }

  const studentIds = studentRes.rows.map(r => r.id);
  const studentsPayload = studentIds.map(id => ({
    student_id: id,
    status: 'present',
    remarks: 'Test remark'
  }));

  // Simulate the payload
  const body = {
    classId,
    sectionId,
    subjectId: null,
    period: 'Period 1 (08:30 AM - 09:30 AM)',
    date: '2026-07-03',
    finalized: true,
    students: studentsPayload
  };

  const tenantId = 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // typical tenant ID in this DB
  const teacherId = '3d0eabde-0695-4935-9dd9-da21ae1dced8'; // typical teacher ID

  console.log('Simulating markSession...');

  // We will run the exact transactional code from markSession
  await client.query('BEGIN');
  try {
    let sessionId;
    // Look for duplicate session matching class, section, date, period, and subject
    const existing = await client.query(`
      SELECT id FROM attendance_sessions 
      WHERE tenant_id::text = $1::text 
        AND class_id::text = $2::text 
        AND section_id::text = $3::text 
        AND date::text = $4::text 
        AND ($5::text IS NULL OR $5::text = '' OR period::text = $5::text)
        AND ($6::text IS NULL OR $6::text = '' OR $6::text = 'all' OR subject_id::text = $6::text)
      LIMIT 1
    `, [tenantId, body.classId, body.sectionId, body.date, body.period || null, body.subjectId || null]);
    
    if (existing.rows.length > 0) {
      console.log('Session already exists, deleting it to start fresh for test');
      await client.query('DELETE FROM attendance_sessions WHERE id = $1', [existing.rows[0].id]);
    }

    // Create session
    let sessionResult;
    try {
      sessionResult = await client.query(`
        INSERT INTO attendance_sessions (
          tenant_id, class_id, section_id, subject_id, teacher_id, marked_by, date, period, finalized, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING id
      `, [
        tenantId,
        body.classId,
        body.sectionId,
        body.subjectId || null,
        teacherId,
        teacherId,
        body.date,
        body.period || null,
        body.finalized !== false
      ]);
    } catch (e) {
      console.log('Insert session error, trying fallback', e.message);
      sessionResult = await client.query(`
        INSERT INTO attendance_sessions (
          section_id, subject_id, teacher_id, date, finalized, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id
      `, [
        body.sectionId,
        body.subjectId || null,
        teacherId,
        body.date,
        body.finalized !== false
      ]);
    }

    sessionId = sessionResult.rows[0].id;
    console.log(`Created session ID: ${sessionId}`);

    // Batch-delete
    const sIds = (body.students || []).map((s) => String(s.student_id));
    if (sIds.length) {
      const delRes = await client.query(
        `DELETE FROM attendance_records WHERE session_id::text = $1::text AND student_id::text = ANY($2::text[])`,
        [sessionId, sIds],
      );
      console.log(`Deleted existing records: ${delRes.rowCount}`);
    }

    // Insert student records
    for (const s of (body.students || [])) {
      try {
        await client.query(`
          INSERT INTO attendance_records (
            session_id, tenant_id, student_id, status, remarks, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        `, [
          sessionId,
          tenantId,
          s.student_id,
          s.status.toLowerCase(),
          s.remarks || null
        ]);
        console.log(`Saved student ${s.student_id}`);
      } catch (e) {
        console.log(`Failed to save student ${s.student_id} with full fields:`, e.message);
        // Fallback: insert without optional columns (tenant_id, remarks)
        await client.query(`
          INSERT INTO attendance_records (
            session_id, student_id, status, created_at, updated_at
          ) VALUES ($1, $2, $3, NOW(), NOW())
        `, [
          sessionId,
          s.student_id,
          s.status.toLowerCase()
        ]);
        console.log(`Saved student ${s.student_id} with fallback`);
      }
    }

    await client.query('COMMIT');
    console.log('SUCCESS! Transaction committed.');
  } catch (err) {
    console.error('ERROR during simulation:', err);
    await client.query('ROLLBACK');
  }

  await client.end();
}

run().catch(console.error);
