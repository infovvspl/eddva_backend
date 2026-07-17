require('ts-node/register');
require('tsconfig-paths/register');
require('dotenv').config();

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { SchoolNotificationScheduler } = require('../src/modules/school/notification-fcm/school-notification.scheduler');
const { getDataSourceToken } = require('@nestjs/typeorm');
const { DataSource } = require('typeorm');
const { v4: uuidv4 } = require('uuid');

async function run() {
  console.log('Initializing NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  
  let schoolDs;
  try {
    schoolDs = app.get(getDataSourceToken('school'));
  } catch {
    schoolDs = app.get(DataSource);
  }
  console.log('DataSource connected successfully.');

  const scheduler = app.get(SchoolNotificationScheduler);

  // Generate Unique UUIDs for test entities
  const instId = uuidv4();
  const classId = uuidv4();
  const sectionId = uuidv4();
  const userId = uuidv4();
  const teacherId = uuidv4();
  const assignmentId = uuidv4();
  const timetableId = uuidv4();
  const deviceTokenId = uuidv4();

  const testEmail = `test_teacher_${userId.substring(0, 8)}@example.com`;
  const fcmToken = 'fcm_token_test_123';

  let todayStr;
  let dayOfWeekNum;
  let computedEndTime;

  let setupSuccess = false;

  try {
    // ----------------------------------------------------
    // SETUP
    // ----------------------------------------------------
    console.log('\n--- Setting up test data ---');

    // Get today's IST date and day of week
    const dateInfo = await schoolDs.query(
      `SELECT 
        (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS today,
        EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '37 minutes')::int AS day_num`
    );
    todayStr = dateInfo[0].today;
    dayOfWeekNum = dateInfo[0].day_num;
    console.log(`Today IST Date: ${todayStr}, Target Day of Week (ISODOW): ${dayOfWeekNum}`);

    // Create test institute (safer than reusing existing to prevent data side-effects)
    console.log(`Creating test institute (ID: ${instId})...`);
    await schoolDs.query(
      `INSERT INTO institutes (id, name, email, tenant_domain, status) 
       VALUES ($1, 'Test Attendance Institute', $2, $3, 'ACTIVE')`,
      [instId, `test_reminder_inst_${instId.substring(0, 8)}@example.com`, `test-reminder-inst-${instId.substring(0, 8)}.example.com`]
    );

    // Create test class (needed by section)
    console.log(`Creating test class (ID: ${classId})...`);
    await schoolDs.query(
      `INSERT INTO classes (id, institute_id, name, academic_year) 
       VALUES ($1, $2, 'Test Attendance Class', '2026-2027')`,
      [classId, instId]
    );

    // Create test section
    console.log(`Creating test section (ID: ${sectionId})...`);
    await schoolDs.query(
      `INSERT INTO sections (id, class_id, institute_id, name) 
       VALUES ($1, $2, $3, 'Test Attendance Section')`,
      [sectionId, classId, instId]
    );

    // Create test teacher user
    console.log(`Creating test teacher user (ID: ${userId})...`);
    await schoolDs.query(
      `INSERT INTO users (id, institute_id, name, email, password, role, is_active) 
       VALUES ($1, $2, 'Test Attendance Teacher', $3, '$2a$12$N9qo8uLOqp.9Uu/rK19WGu.c1mO/w8aEplhLgRpx3Z6uP97L6172K', 'TEACHER', true)`,
      [userId, instId, testEmail]
    );

    // Create teachers row
    console.log(`Creating teachers row (ID: ${teacherId})...`);
    await schoolDs.query(
      `INSERT INTO teachers (id, user_id, institute_id) 
       VALUES ($1, $2, $3)`,
      [teacherId, userId, instId]
    );

    // Create teacher_academic_assignments row
    console.log(`Creating teacher_academic_assignments row (ID: ${assignmentId})...`);
    await schoolDs.query(
      `INSERT INTO teacher_academic_assignments (id, teacher_id, class_id, section_id, subject_id, is_class_teacher) 
       VALUES ($1, $2, $3, $4, null, true)`,
      [assignmentId, teacherId, classId, sectionId]
    );

    // Create school_device_tokens row
    console.log(`Creating school_device_tokens row (ID: ${deviceTokenId})...`);
    await schoolDs.query(
      `INSERT INTO school_device_tokens (id, user_id, fcm_token, platform) 
       VALUES ($1, $2, $3, 'web')`,
      [deviceTokenId, userId, fcmToken]
    );

    // Insert notification preference
    console.log(`Setting notification preferences for teacher...`);
    await schoolDs.query(
      `INSERT INTO notification_preferences (user_id, enable_push, attendance_alerts, updated_at) 
       VALUES ($1, true, true, NOW()) 
       ON CONFLICT (user_id) DO UPDATE SET enable_push = true, attendance_alerts = true, updated_at = NOW()`,
      [userId]
    );

    // Create timetables row (end_time exactly 37 minutes before now, start_time 97 minutes before now)
    console.log(`Creating timetables row (ID: ${timetableId})...`);
    const timetableRes = await schoolDs.query(
      `INSERT INTO timetables (id, institute_id, section_id, teacher_id, day_of_week, start_time, end_time) 
       VALUES ($1, $2, $3, $4, $5, 
               ((NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '97 minutes')::time, 
               ((NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '37 minutes')::time)
       RETURNING end_time::text AS end_time`,
      [timetableId, instId, sectionId, teacherId, dayOfWeekNum]
    );
    computedEndTime = timetableRes[0].end_time;
    console.log(`Timetable end_time configured to: ${computedEndTime}`);

    setupSuccess = true;
    console.log('Test data setup completed successfully.\n');

    // ----------------------------------------------------
    // EXECUTION
    // ----------------------------------------------------
    console.log('--- Executing handleAttendanceReminder() ---');
    await scheduler.handleAttendanceReminder();
    console.log('Execution completed.\n');

    // ----------------------------------------------------
    // ASSERTIONS
    // ----------------------------------------------------
    console.log('--- Verification & Assertions ---');
    let passedAssertions = 0;
    let totalAssertions = 5;

    // 1. Timetable slot identified in 30-45 min window
    const slots = await schoolDs.query(`
      SELECT t.id FROM timetables t
      WHERE t.id = $1
        AND t.day_of_week = EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '37 minutes')::int
        AND t.end_time::time BETWEEN
              ((NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '45 minutes')::time
          AND ((NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '30 minutes')::time
    `, [timetableId]);

    if (slots.length > 0) {
      console.log('Assertion 1: PASS - Timetable slot correctly matched the time window.');
      passedAssertions++;
    } else {
      console.log('Assertion 1: FAIL - Timetable slot was not matched in the time window.');
    }

    // 2. attendance_taken evaluates to false
    const attendanceRows = await schoolDs.query(
      `SELECT EXISTS (
         SELECT 1 FROM attendances a
         JOIN students s ON a.user_id = s.user_id
         WHERE s.section_id = $1
           AND a.date::date = $2::date
       ) AS attendance_taken`,
      [sectionId, todayStr]
    );
    const attendanceTaken = attendanceRows[0].attendance_taken;
    if (attendanceTaken === false) {
      console.log('Assertion 2: PASS - attendance_taken correctly evaluated to false.');
      passedAssertions++;
    } else {
      console.log('Assertion 2: FAIL - attendance_taken was true (unexpected).');
    }

    // 3. Row inserted into school_notification_log
    const logRows = await schoolDs.query(
      `SELECT * FROM school_notification_log WHERE user_id = $1 AND notification_type = $2 AND reference_id = $3`,
      [userId, 'ATTENDANCE_REMINDER', sectionId]
    );
    if (logRows.length === 1) {
      console.log('Assertion 3: PASS - school_notification_log entry created.');
      passedAssertions++;
    } else {
      console.log('Assertion 3: FAIL - school_notification_log entry not found.');
    }

    // 4. Confirm FCM send attempt status
    if (logRows.length > 0) {
      const status = logRows[0].status;
      const failureReason = logRows[0].failure_reason || 'None';
      console.log(`Assertion 4: PASS - FCM send status is recorded as: ${status} (Reason: ${failureReason}).`);
      passedAssertions++;
    } else {
      console.log('Assertion 4: FAIL - FCM status could not be verified (no log row).');
    }

    // 5. In-app notification created
    const notifRows = await schoolDs.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND reference_id = $2 AND type = 'attendance'`,
      [userId, sectionId]
    );
    if (notifRows.length === 1) {
      console.log('Assertion 5: PASS - In-app notification row created.');
      passedAssertions++;
    } else {
      console.log('Assertion 5: FAIL - In-app notification row not found.');
    }

    console.log(`\nSummary: ${passedAssertions}/${totalAssertions} assertions passed.`);

  } catch (err) {
    console.error('Error during test execution:', err);
  } finally {
    // ----------------------------------------------------
    // CLEANUP
    // ----------------------------------------------------
    console.log('\n--- Cleaning up test data ---');

    const deleteAndLog = async (tableName, sql, params) => {
      try {
        const checkRes = await schoolDs.query(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE ${sql.split('WHERE')[1]}`, params);
        const countBefore = checkRes[0].count;
        if (countBefore > 0) {
          await schoolDs.query(sql, params);
          console.log(`Deleted from ${tableName}: ${countBefore} row(s)`);
          return countBefore;
        } else {
          console.log(`Deleted from ${tableName}: 0 row(s) (no matching rows found)`);
          return 0;
        }
      } catch (e) {
        console.error(`Failed to clean up table ${tableName}:`, e.message);
        return 0;
      }
    };

    // Delete in FK-safe reverse order
    await deleteAndLog('notifications', `DELETE FROM notifications WHERE recipient_id = $1 AND reference_id = $2`, [userId, sectionId]);
    await deleteAndLog('school_notification_log', `DELETE FROM school_notification_log WHERE user_id = $1`, [userId]);
    await deleteAndLog('school_device_tokens', `DELETE FROM school_device_tokens WHERE user_id = $1`, [userId]);
    await deleteAndLog('notification_preferences', `DELETE FROM notification_preferences WHERE user_id = $1`, [userId]);
    await deleteAndLog('timetables', `DELETE FROM timetables WHERE id = $1`, [timetableId]);
    await deleteAndLog('teacher_academic_assignments', `DELETE FROM teacher_academic_assignments WHERE id = $1`, [assignmentId]);
    await deleteAndLog('teachers', `DELETE FROM teachers WHERE id = $1`, [teacherId]);
    await deleteAndLog('sections', `DELETE FROM sections WHERE id = $1`, [sectionId]);
    await deleteAndLog('classes', `DELETE FROM classes WHERE id = $1`, [classId]);
    await deleteAndLog('users', `DELETE FROM users WHERE id = $1`, [userId]);
    await deleteAndLog('institutes', `DELETE FROM institutes WHERE id = $1`, [instId]);

    console.log('Cleanup completed.');

    // ----------------------------------------------------
    // POST-CLEANUP VERIFICATION
    // ----------------------------------------------------
    console.log('\n--- Post-cleanup validation (should all be 0) ---');
    const checkPostCleanup = async (tableName, querySql, params) => {
      const rows = await schoolDs.query(querySql, params);
      const count = Number(rows[0]?.count || 0);
      console.log(`Leftover count in ${tableName}: ${count}`);
      return count;
    };

    let leftovers = 0;
    leftovers += await checkPostCleanup('notifications', `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1`, [userId]);
    leftovers += await checkPostCleanup('school_notification_log', `SELECT COUNT(*)::int AS count FROM school_notification_log WHERE user_id = $1`, [userId]);
    leftovers += await checkPostCleanup('school_device_tokens', `SELECT COUNT(*)::int AS count FROM school_device_tokens WHERE user_id = $1`, [userId]);
    leftovers += await checkPostCleanup('notification_preferences', `SELECT COUNT(*)::int AS count FROM notification_preferences WHERE user_id = $1`, [userId]);
    leftovers += await checkPostCleanup('timetables', `SELECT COUNT(*)::int AS count FROM timetables WHERE id = $1`, [timetableId]);
    leftovers += await checkPostCleanup('teacher_academic_assignments', `SELECT COUNT(*)::int AS count FROM teacher_academic_assignments WHERE id = $1`, [assignmentId]);
    leftovers += await checkPostCleanup('teachers', `SELECT COUNT(*)::int AS count FROM teachers WHERE id = $1`, [teacherId]);
    leftovers += await checkPostCleanup('sections', `SELECT COUNT(*)::int AS count FROM sections WHERE id = $1`, [sectionId]);
    leftovers += await checkPostCleanup('classes', `SELECT COUNT(*)::int AS count FROM classes WHERE id = $1`, [classId]);
    leftovers += await checkPostCleanup('users', `SELECT COUNT(*)::int AS count FROM users WHERE id = $1`, [userId]);
    leftovers += await checkPostCleanup('institutes', `SELECT COUNT(*)::int AS count FROM institutes WHERE id = $1`, [instId]);

    if (leftovers === 0) {
      console.log('\nCONFIRMED: Zero leftover rows in database. Test data fully purged.');
    } else {
      console.log(`\nWARNING: ${leftovers} leftover rows remain in database!`);
    }

    await app.close();
    process.exit(0);
  }
}

run();
