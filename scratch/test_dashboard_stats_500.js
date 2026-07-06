const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const queries = [
    { name: '1. totalInstRow', sql: `SELECT COUNT(*)::int AS c FROM institutes` },
    { name: '2. pendingRow', sql: `SELECT COUNT(*)::int AS c FROM institutes WHERE status='PENDING'` },
    { name: '3. totalTeachersRow', sql: `SELECT COUNT(*)::int AS c FROM users WHERE role='TEACHER' AND institute_id IN (SELECT id FROM institutes)` },
    { name: '4. totalStudentsRow', sql: `SELECT COUNT(*)::int AS c FROM users WHERE role='STUDENT' AND institute_id IN (SELECT id FROM institutes)` },
    { name: '5. totalParentsRow', sql: `SELECT COUNT(*)::int AS c FROM users WHERE role='PARENT' AND institute_id IN (SELECT id FROM institutes)` },
    { name: '6. openComplaintsRow', sql: `SELECT COUNT(*)::int AS c FROM complaints WHERE status::text IN ('OPEN', 'IN_PROGRESS')` },
    { name: '7. totalUsersRow', sql: `SELECT COUNT(*)::int AS c FROM users WHERE role IN ('INSTITUTE_ADMIN', 'TEACHER', 'STUDENT', 'PARENT') AND institute_id IN (SELECT id FROM institutes)` },
    { name: '8. activeSchoolsRow', sql: `SELECT COUNT(*)::int AS c FROM institutes WHERE status='ACTIVE'` },
    { name: '9. activeUsersRow', sql: `SELECT COUNT(*)::int AS c FROM users WHERE is_active = true AND role IN ('INSTITUTE_ADMIN', 'TEACHER', 'STUDENT', 'PARENT') AND institute_id IN (SELECT id FROM institutes)` },
    { name: '10. recentInstitutesRows', sql: `SELECT id, name, status, principal_name AS "principalName", created_at AS "createdAt" FROM institutes ORDER BY created_at DESC LIMIT 5` },
    { name: '11. recentTicketsRows', sql: `SELECT c.id, c.title, c.status, i.name AS "instituteName" FROM complaints c LEFT JOIN institutes i ON i.id = c.institute_id ORDER BY c.created_at DESC LIMIT 5` },
    { name: '12. topInstRows', sql: `SELECT i.name, COUNT(u.id)::int AS users, 0 AS faculty, 0 AS revenue FROM institutes i LEFT JOIN users u ON u.institute_id = i.id GROUP BY i.id, i.name ORDER BY users DESC LIMIT 5` },
    { name: '13. monthlyInstRows', sql: `WITH months AS (SELECT generate_series(DATE_TRUNC('month', NOW()) - INTERVAL '5 months', DATE_TRUNC('month', NOW()), INTERVAL '1 month') AS month_start) SELECT TO_CHAR(m.month_start, 'Mon') AS name, COALESCE(COUNT(i.id), 0)::int AS institutes, COALESCE(COUNT(i.id) FILTER (WHERE i.status = 'ACTIVE'), 0)::int AS approved FROM months m LEFT JOIN institutes i ON DATE_TRUNC('month', i.created_at) = m.month_start GROUP BY m.month_start ORDER BY m.month_start` },
    { name: '14. monthlyUserRows', sql: `WITH months AS (SELECT generate_series(DATE_TRUNC('month', NOW()) - INTERVAL '5 months', DATE_TRUNC('month', NOW()), INTERVAL '1 month') AS month_start) SELECT TO_CHAR(m.month_start, 'Mon') AS name, COALESCE(COUNT(u.id), 0)::int AS users, COALESCE(COUNT(u.id) FILTER (WHERE u.is_active = TRUE), 0)::int AS active FROM months m LEFT JOIN users u ON DATE_TRUNC('month', u.created_at) = m.month_start AND u.role IN ('INSTITUTE_ADMIN', 'TEACHER', 'STUDENT', 'PARENT') AND u.institute_id IN (SELECT id FROM institutes) GROUP BY m.month_start ORDER BY m.month_start` },
    { name: '15. monthlyRevenueRows', sql: `WITH months AS (SELECT generate_series(DATE_TRUNC('month', NOW()) - INTERVAL '5 months', DATE_TRUNC('month', NOW()), INTERVAL '1 month') AS month_start), billed_agg AS (SELECT DATE_TRUNC('month', due_date) AS month_start, SUM(amount) AS billed_amount FROM fees GROUP BY DATE_TRUNC('month', due_date)), paid_agg AS (SELECT DATE_TRUNC('month', paid_date) AS month_start, SUM(amount) AS paid_amount FROM fees WHERE UPPER(status::text) IN ('PAID', 'COMPLETED', 'RECEIVED') GROUP BY DATE_TRUNC('month', paid_date)) SELECT TO_CHAR(m.month_start, 'Mon') AS name, COALESCE(b.billed_amount, 0)::numeric AS billed, COALESCE(p.paid_amount, 0)::numeric AS revenue FROM months m LEFT JOIN billed_agg b ON b.month_start = m.month_start LEFT JOIN paid_agg p ON p.month_start = m.month_start ORDER BY m.month_start` },
    { name: '16. schoolAiSessionsRes', sql: `SELECT COUNT(*)::int AS c FROM school_ai_study_sessions WHERE created_at >= CURRENT_DATE` },
    { name: '17. aiHourlyRows', sql: `WITH hours AS (SELECT generate_series(DATE_TRUNC('day', NOW()), DATE_TRUNC('day', NOW()) + INTERVAL '23 hours', INTERVAL '1 hour') AS hour_start) SELECT TO_CHAR(h.hour_start, 'HH24:00') AS time, COALESCE(COUNT(s.id), 0)::int AS sessions FROM hours h LEFT JOIN school_ai_study_sessions s ON DATE_TRUNC('hour', s.created_at) = h.hour_start GROUP BY h.hour_start ORDER BY h.hour_start` },
    { name: '18. schoolMaterialsRes', sql: `SELECT SUM(file_size_kb)::bigint AS total FROM study_materials` },
    { name: '19. securityAlertsRow', sql: `SELECT COUNT(*)::int AS c FROM activity_logs WHERE action = 'SUPER_ADMIN signed in' AND created_at >= NOW() - INTERVAL '24 hours'` }
  ];

  for (const q of queries) {
    try {
      await client.query(q.sql);
      console.log(`[PASS] ${q.name}`);
    } catch (err) {
      console.error(`[FAIL] ${q.name}:`, err.message);
    }
  }

  await client.end();
}

run().catch(console.error);
