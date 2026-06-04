const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});

async function run() {
  await client.connect();
  
  // Let's find a valid institute ID
  const instRes = await client.query('SELECT id, name FROM institutes LIMIT 1');
  if (instRes.rows.length === 0) {
    console.log('No institutes found');
    await client.end();
    return;
  }
  const instId = instRes.rows[0].id;
  const instName = instRes.rows[0].name;
  console.log(`Using Institute: ${instName} (${instId})`);
  
  // Find a valid class/section if any
  const secRes = await client.query(`
    SELECT s.id, s.name as sec_name, c.name as class_name 
    FROM sections s JOIN classes c ON s.class_id=c.id 
    WHERE c.institute_id=$1 LIMIT 1
  `, [instId]);
  
  let testClass = null;
  let testSection = null;
  if (secRes.rows.length > 0) {
    testClass = secRes.rows[0].class_name;
    testSection = secRes.rows[0].sec_name;
    console.log(`Using Class: ${testClass}, Section: ${testSection}`);
  }

  // Let's run a test bulk import simulation
  const user = { role: 'INSTITUTE_ADMIN', instituteId: instId };
  
  // We'll simulate the service bulkImport code
  const records = [
    {
      name: 'Bulk Student Test',
      email: `bulk.student.${Math.floor(Math.random() * 100000)}@test.com`,
      password: 'password123',
      class: testClass,
      section: testSection,
      rollNo: '101',
      dob: '2012-05-15',
      gender: 'MALE',
      bloodGroup: 'O+',
      fatherName: 'Father Name',
      motherName: 'Mother Name',
      parentPhone: '9999999999',
      parentEmail: 'parent.test@test.com',
      address: '123 Test St',
      city: 'Test City',
      state: 'Test State',
      pinCode: '123456'
    }
  ];
  
  console.log('Simulating bulkImport...');
  
  // Look up sections for mapping
  const sectionsRes = await client.query(
    `SELECT s.id, s.name AS section_name, c.name AS class_name 
     FROM sections s 
     JOIN classes c ON s.class_id = c.id 
     WHERE c.institute_id = $1`,
    [instId]
  );
  
  const sectionMap = new Map();
  for (const s of sectionsRes.rows) {
    const key = `${s.class_name.trim().toLowerCase()} / ${s.section_name.trim().toLowerCase()}`;
    sectionMap.set(key, s.id);
  }
  
  const imported = [];
  const errors = [];
  const bcrypt = require('bcryptjs');

  for (let i = 0; i < records.length; i++) {
    const row = i + 1;
    const rec = records[i];
    try {
      if (!rec.name?.trim()) throw new Error('Name is required');
      if (!rec.email?.trim()) throw new Error('Email is required');
      if (!rec.password?.trim()) throw new Error('Password is required');

      const existing = await client.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, [rec.email.trim()]);
      if (existing.rows.length) throw new Error('Email already exists');

      let sectionId = null;
      if (rec.class && rec.section) {
        const key = `${rec.class.trim().toLowerCase()} / ${rec.section.trim().toLowerCase()}`;
        sectionId = sectionMap.get(key) || null;
        if (!sectionId) throw new Error(`Class "${rec.class}" and Section "${rec.section}" not found`);
      }

      const hashed = await bcrypt.hash(rec.password, 10);
      
      // Generate enrollmentNo
      const prefix = `TEST-ENR-`;
      const enrollmentNo = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;

      console.log('Inserting user...');
      const uRows = await client.query(
        `INSERT INTO users (institute_id,name,email,password,role,phone,is_active) VALUES ($1,$2,$3,$4,'STUDENT',$5,TRUE) RETURNING id`,
        [instId, rec.name.trim(), rec.email.trim().toLowerCase(), hashed, rec.phone || null],
      );
      const userId = uRows.rows[0].id;

      console.log(`Inserting student profile for userId ${userId}...`);
      await client.query(
        `INSERT INTO students (user_id,institute_id,enrollment_no,roll_no,section_id,dob,gender,blood_group,father_name,mother_name,parent_phone,parent_email,address,city,state,pin_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          userId,
          instId,
          enrollmentNo,
          rec.rollNo || null,
          sectionId,
          rec.dob ? new Date(rec.dob) : null,
          rec.gender || null,
          rec.bloodGroup || null,
          rec.fatherName || null,
          rec.motherName || null,
          rec.parentPhone || null,
          rec.parentEmail || null,
          rec.address || null,
          rec.city || null,
          rec.state || null,
          rec.pinCode || null
        ]
      );

      imported.push({ row, email: rec.email });
      console.log('Successfully imported test student!');
      
      // Clean up test data
      await client.query('DELETE FROM students WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM users WHERE id=$1', [userId]);
      console.log('Cleaned up test student data.');
    } catch (err) {
      errors.push({ row, email: rec.email || 'N/A', error: err.message });
      console.error('Import error on row', row, ':', err.message);
    }
  }

  await client.end();
}

run().catch(console.error);
