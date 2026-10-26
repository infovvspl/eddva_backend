require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Reusable seeder: tops up each section of a school's classes (current academic
// year only) so every section has MIN_PER_SECTION-MAX_PER_SECTION students and
// each class's total across its sections lands as close to TARGET_CLASS_TOTAL
// as those per-section bounds allow. Never removes existing students.
//
// Usage:
//   node scripts/seed-eddva-students.js --institute-id=<uuid> [--classes="Class 1,Class 2"]
//   SEED_INSTITUTE_ID=<uuid> node scripts/seed-eddva-students.js
// With no --institute-id/env var, defaults to Eddva School (this script's original target).

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const INSTITUTE_ID = args['institute-id'] || process.env.SEED_INSTITUTE_ID || 'c259cd4e-b018-45e2-8e46-52a497ca49a1'; // Eddva School
const EMAIL_DOMAIN = args['email-domain'] || process.env.SEED_EMAIL_DOMAIN || 'apsschool.in'; // matches institute tenant_domain 'aps', consistent with existing student rows
const DEFAULT_PASSWORD = args['password'] || 'Student@123';
const MIN_PER_SECTION = parseInt(args['min-per-section'], 10) || 30;
const MAX_PER_SECTION = parseInt(args['max-per-section'], 10) || 45;
const TARGET_CLASS_TOTAL = parseInt(args['total-per-class'], 10) || 100;
// Optional: restrict to specific class names, comma-separated. Default: every class in the current academic year.
const ONLY_CLASS_NAMES = args['classes'] ? String(args['classes']).split(',').map((s) => s.trim()).filter(Boolean) : null;

const MALE_FIRST_NAMES = [
  'Aarav', 'Rohan', 'Aditya', 'Rahul', 'Vivek', 'Amit', 'Sandeep', 'Vikram', 'Ankit', 'Deepak',
  'Saurabh', 'Gaurav', 'Nikhil', 'Suresh', 'Manish', 'Vijay', 'Arjun', 'Karan', 'Rajat', 'Mohit',
  'Ayaan', 'Zaid', 'Imran', 'Faisal', 'Shivam', 'Harsh', 'Yash', 'Kunal', 'Abhishek', 'Pranav',
  'Devansh', 'Krishna', 'Lakshay', 'Mayank', 'Naveen', 'Om', 'Parth', 'Raghav', 'Sameer', 'Tanish',
];
const FEMALE_FIRST_NAMES = [
  'Ananya', 'Priya', 'Neha', 'Pooja', 'Riya', 'Kavya', 'Isha', 'Sneha', 'Shreya', 'Simran',
  'Anjali', 'Divya', 'Swati', 'Nisha', 'Ritu', 'Kirti', 'Aditi', 'Khushi', 'Zara', 'Ayesha',
  'Fatima', 'Sana', 'Mahi', 'Tanvi', 'Vaishnavi', 'Komal', 'Rashi', 'Preeti', 'Megha', 'Sakshi',
  'Ira', 'Jiya', 'Kiara', 'Lavanya', 'Mahira', 'Naira', 'Oviya', 'Palak', 'Riddhi', 'Saanvi',
];
const SURNAMES = [
  'Yadav', 'Singh', 'Gupta', 'Sharma', 'Verma', 'Mishra', 'Pandey', 'Tiwari', 'Srivastava', 'Agarwal',
  'Chaudhary', 'Rastogi', 'Khan', 'Ansari', 'Siddiqui', 'Jaiswal', 'Pal', 'Maurya', 'Dubey', 'Shukla',
  'Rai', 'Tripathi', 'Kushwaha', 'Nigam', 'Saxena', 'Bhatt', 'Chauhan', 'Kannaujia', 'Rawat', 'Dixit',
];
const OCCUPATIONS = [
  'Farmer', 'Businessman', 'Government Teacher', 'Private Teacher', 'Shopkeeper', 'Bank Employee',
  'Doctor', 'Engineer', 'Police Constable', 'Railway Employee', 'Advocate', 'Tailor', 'Electrician',
  'Driver', 'Clerk', 'Nurse', 'Pharmacist', 'Contractor', 'Homemaker', 'Carpenter',
];
const BLOOD_GROUPS = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-'];
const BLOOD_GROUP_WEIGHTS = [0.35, 0.20, 0.20, 0.07, 0.07, 0.04, 0.05, 0.02];
const CASTE_CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS'];
const CASTE_WEIGHTS = [0.3, 0.4, 0.17, 0.08, 0.05];
const PREVIOUS_SCHOOLS = [
  'Little Angels Public School, Gorakhpur', 'St. Joseph\'s School, Gorakhpur', 'Vivekanand Vidyalaya, Gorakhpur',
  'Kendriya Vidyalaya, Gorakhpur', 'Bal Vikas Public School, Gorakhpur', 'Sunbeam School, Gorakhpur',
  'City Montessori School, Gorakhpur', 'Rani Laxmi Bai Memorial School, Gorakhpur',
];
const TRANSFER_REASONS = [
  'Relocation within city', 'Family relocated from another city', 'Seeking better facilities',
  'Preferred CBSE curriculum', 'Closer to residence', 'Parent\'s job transfer',
];
const LOCALITIES = [
  'Civil Lines', 'Rustampur', 'Taramandal', 'Shahpur', 'Betiahata', 'Gorakhnath', 'Golghar',
  'Mohaddipur', 'Basharatpur', 'Paadri Bazar', 'Jatashankar', 'Raptinagar', 'Dhoodh Bangla',
  'Kunraghat', 'Gida', 'Sahjanwa Road',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function weightedPick(arr, weights) {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += weights[i];
    if (r <= acc) return arr[i];
  }
  return arr[arr.length - 1];
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pad(n, len) { return String(n).padStart(len, '0'); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function randomDate(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const start = new Date(startYear, startMonth - 1, startDay).getTime();
  const end = new Date(endYear, endMonth - 1, endDay).getTime();
  const t = start + Math.random() * (end - start);
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}

function classLevel(className) {
  const m = className.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

// Current academic year 2025-2026, "today" is 2026-10-21. A Class-N student is
// roughly (5 + N) years old by the start of this academic year (June 2025).
function dobForClass(level) {
  const age = 5 + level;
  const birthYear = 2025 - age;
  return randomDate(birthYear, 1, 1, birthYear, 12, 28);
}

// Students who started in Class 1 and have been promoted each year joined that
// many years before the current 2025-2026 session began.
function admissionDateForClass(level) {
  const yearsAgo = level - 1;
  const admissionYear = 2025 - yearsAgo;
  return randomDate(admissionYear, 6, 1, admissionYear, 7, 15);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

// Spread `total` across `count` buckets, each kept within [min, max], landing as
// close to `total` as those bounds allow (never reaches the input total if
// count * min > total or count * max < total).
function distributeWithBounds(count, total, min, max) {
  if (count <= 0) return [];
  let base = clamp(Math.floor(total / count), min, max);
  const targets = new Array(count).fill(base);
  let remainder = total - base * count;
  let i = 0;
  let guard = 0;
  while (remainder !== 0 && guard < count * (max - min + 1)) {
    const idx = i % count;
    if (remainder > 0 && targets[idx] < max) { targets[idx] += 1; remainder -= 1; }
    else if (remainder < 0 && targets[idx] > min) { targets[idx] -= 1; remainder += 1; }
    i += 1;
    guard += 1;
  }
  return targets;
}

async function main() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const yearRes = await client.query(`SELECT MAX(academic_year) y FROM classes WHERE institute_id = $1`, [INSTITUTE_ID]);
    const currentAcademicYear = yearRes.rows[0]?.y;
    if (!currentAcademicYear) {
      throw new Error(`No classes found for institute ${INSTITUTE_ID}`);
    }

    const classParams = [INSTITUTE_ID, currentAcademicYear];
    let classNameFilter = '';
    if (ONLY_CLASS_NAMES) {
      classParams.push(ONLY_CLASS_NAMES);
      classNameFilter = `AND name = ANY($${classParams.length}::text[])`;
    }
    const classRes = await client.query(
      `SELECT id, name FROM classes WHERE institute_id = $1 AND academic_year = $2 ${classNameFilter}`,
      classParams,
    );
    const targetClassNames = classRes.rows.map((r) => r.name);
    if (targetClassNames.length === 0) {
      throw new Error(`No matching classes found for institute ${INSTITUTE_ID}, academic year ${currentAcademicYear}`);
    }

    const sectionRes = await client.query(
      `SELECT sec.id, sec.name AS section_name, sec.class_id, cl.name AS class_name
       FROM sections sec JOIN classes cl ON cl.id = sec.class_id
       WHERE cl.institute_id = $1 AND cl.academic_year = $2 AND cl.name = ANY($3::text[])
       ORDER BY cl.name, sec.name`,
      [INSTITUTE_ID, currentAcademicYear, targetClassNames],
    );

    // existing active student counts per section, so we only top up, never remove
    const countRes = await client.query(
      `SELECT section_id, COUNT(*)::int AS c, MAX(roll_no::int) AS max_roll
       FROM students WHERE institute_id = $1 AND status = 'ACTIVE' AND roll_no ~ '^[0-9]+$'
       GROUP BY section_id`,
      [INSTITUTE_ID],
    );
    const countBySection = new Map(countRes.rows.map((r) => [r.section_id, { count: r.c, maxRoll: r.max_roll || 0 }]));

    const existingEmails = new Set(
      (await client.query(`SELECT email FROM users WHERE institute_id = $1`, [INSTITUTE_ID])).rows.map((r) => r.email.toLowerCase()),
    );
    const existingPhones = new Set(
      (await client.query(`SELECT phone FROM users WHERE institute_id = $1 AND phone IS NOT NULL`, [INSTITUTE_ID])).rows.map((r) => r.phone),
    );

    // group sections by class so we can compute each class's per-section targets
    const sectionsByClass = new Map();
    for (const row of sectionRes.rows) {
      if (!sectionsByClass.has(row.class_id)) sectionsByClass.set(row.class_id, { className: row.class_name, sections: [] });
      sectionsByClass.get(row.class_id).sections.push(row);
    }

    const plan = []; // { section, additions }
    for (const { className, sections } of sectionsByClass.values()) {
      const targets = distributeWithBounds(sections.length, TARGET_CLASS_TOTAL, MIN_PER_SECTION, MAX_PER_SECTION);
      sections.forEach((section, i) => {
        const current = countBySection.get(section.id)?.count || 0;
        const additions = Math.max(0, targets[i] - current);
        plan.push({ section, additions, className });
      });
    }

    const totalNewStudents = plan.reduce((sum, p) => sum + p.additions, 0);
    if (totalNewStudents === 0) {
      console.log('Every targeted section is already within range. Nothing to seed.');
      return;
    }

    const enrollRes = await client.query(
      `SELECT MAX(erp_enrollment_number) m FROM students WHERE institute_id = $1 AND erp_enrollment_number LIKE 'EDV-2026-%'`,
      [INSTITUTE_ID],
    );
    let enrollSeq = 0;
    if (enrollRes.rows[0].m) {
      const m = enrollRes.rows[0].m.match(/(\d+)$/);
      if (m) enrollSeq = parseInt(m[1], 10);
    }

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

    await client.query('BEGIN');

    let created = 0;
    for (const { section, additions, className } of plan) {
      if (additions === 0) continue;
      const level = classLevel(className);
      let nextRoll = (countBySection.get(section.id)?.maxRoll || 0) + 1;

      for (let i = 0; i < additions; i++) {
        const isMale = Math.random() < 0.52;
        const firstName = isMale ? pick(MALE_FIRST_NAMES) : pick(FEMALE_FIRST_NAMES);
        const surname = pick(SURNAMES);
        const fullName = `${firstName} ${surname}`;

        enrollSeq += 1;
        let emailLocal = `${slug(firstName)}.${slug(surname)}${enrollSeq}`;
        let email = `${emailLocal}@${EMAIL_DOMAIN}`;
        while (existingEmails.has(email.toLowerCase())) {
          emailLocal = `${emailLocal}x`;
          email = `${emailLocal}@${EMAIL_DOMAIN}`;
        }
        existingEmails.add(email.toLowerCase());

        let phone;
        do {
          phone = `9${randInt(100000000, 999999999)}`;
        } while (existingPhones.has(phone));
        existingPhones.add(phone);

        let parentPhone;
        do {
          parentPhone = `${pick(['6', '7', '8', '9'])}${randInt(100000000, 999999999)}`;
        } while (existingPhones.has(parentPhone));
        existingPhones.add(parentPhone);

        const fatherFirstName = pick(MALE_FIRST_NAMES);
        const motherFirstName = pick(FEMALE_FIRST_NAMES);
        const fatherName = `${fatherFirstName} ${surname}`;
        const motherName = `${motherFirstName} ${surname}`;
        const fatherOccupation = pick(OCCUPATIONS);

        const dob = dobForClass(level);
        const admissionDate = admissionDateForClass(level);
        const enrollmentNo = `EDV-2026-${pad(enrollSeq, 4)}`;
        const rollNo = String(nextRoll);
        nextRoll += 1;

        const locality = pick(LOCALITIES);
        const houseNo = randInt(1, 400);
        const address = `House No. ${houseNo}, ${locality}`;
        const pinCode = `2730${pad(randInt(1, 16), 2)}`;

        const userId = crypto.randomUUID();
        const studentId = crypto.randomUUID();
        const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(emailLocal)}`;
        const parentEmail = `${slug(fatherFirstName)}.${slug(surname)}${enrollSeq}@gmail.com`;

        await client.query(
          `INSERT INTO users (
             id, institute_id, name, email, password, role, profile_image, phone,
             is_active, email_verified, phone_verified, is_first_login, photo, notification_prefs
           ) VALUES ($1,$2,$3,$4,$5,'STUDENT',$6,$7,true,true,true,true,$8,$9)`,
          [
            userId, INSTITUTE_ID, fullName, email, passwordHash, avatarUrl, phone,
            avatarUrl, JSON.stringify({ email: true, sms: true, push: true }),
          ],
        );

        await client.query(
          `INSERT INTO students (
             id, user_id, institute_id, address, city, state, pin_code,
             enrollment_no, roll_no, section_id, dob, gender, blood_group, marital_status,
             national_id, father_name, mother_name, parent_phone, parent_email, parent_occupation,
             admission_date, medical_conditions, allergies, documents, xp_total, notification_enabled,
             previous_school_name, previous_admission_no, reason_for_transfer, caste_category,
             board_registration_no, board_name, document_verification, status,
             min_attendance_percentage, erp_enrollment_number, credentials_sent_at, credentials_sent_count,
             student_credentials_sent_at, student_credentials_sent_count
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,
             $8,$9,$10,$11,$12,$13,$14,
             $15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,
             $27,$28,$29,$30,
             $31,$32,$33,$34,
             $35,$36,$37,$38,
             $39,$40
           )`,
          [
            studentId, userId, INSTITUTE_ID, address, 'Gorakhpur', 'Uttar Pradesh', pinCode,
            enrollmentNo, rollNo, section.id, dob, isMale ? 'Male' : 'Female', weightedPick(BLOOD_GROUPS, BLOOD_GROUP_WEIGHTS), 'Unmarried',
            String(randInt(100000000000, 999999999999)), fatherName, motherName, parentPhone, parentEmail, fatherOccupation,
            admissionDate, 'None', 'None', JSON.stringify({ birthCertificate: true, aadharCard: true, transferCertificate: level > 1, photo: true }), randInt(0, 150), true,
            level === 1 ? 'N/A - First Admission' : pick(PREVIOUS_SCHOOLS), level === 1 ? 'N/A' : `TC-${randInt(1000, 9999)}`, level === 1 ? 'New Admission' : pick(TRANSFER_REASONS), weightedPick(CASTE_CATEGORIES, CASTE_WEIGHTS),
            `CBSE-${INSTITUTE_ID.slice(0, 4).toUpperCase()}-${enrollSeq}`, 'CBSE', JSON.stringify({ status: 'VERIFIED', verifiedBy: 'Admin Office', verifiedAt: admissionDate }), 'ACTIVE',
            80, enrollmentNo, admissionDate, 1,
            admissionDate, 1,
          ],
        );

        created += 1;
      }
    }

    const finalCountRes = await client.query(
      `SELECT COUNT(*)::int c FROM students WHERE institute_id = $1`,
      [INSTITUTE_ID],
    );
    const finalCount = finalCountRes.rows[0].c;
    const newMax = Math.ceil((finalCount + 50) / 100) * 100; // headroom above the actual count
    await client.query(
      `UPDATE institutes SET max_students = $2, total_students = $3 WHERE id = $1`,
      [INSTITUTE_ID, newMax, String(finalCount)],
    );

    await client.query('COMMIT');
    console.log(`Created ${created} students across ${plan.filter((p) => p.additions > 0).length} sections (institute ${INSTITUTE_ID}, academic year ${currentAcademicYear}).`);
    for (const { section, additions, className } of plan) {
      if (additions > 0) console.log(`  ${className} / ${section.section_name}: +${additions}`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
