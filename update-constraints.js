const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });

const tablesToUpdate = [
  { table: 'classes', constraint: 'classes_institute_id_fkey' },
  { table: 'subjects', constraint: 'FK_31ce5efac405256a51668a0e34e' },
  { table: 'topics', constraint: 'FK_44dc6b6f929c6894f621828e915' },
  { table: 'fees', constraint: 'FK_725b48aed0b23a1fac72315575b' },
  { table: 'complaints', constraint: 'FK_11ccef611cce7de2527f37e5896' },
  { table: 'activity_logs', constraint: 'activity_logs_institute_id_fkey' },
  { table: 'notices', constraint: 'notices_institute_id_fkey' },
  { table: 'attendances', constraint: 'attendances_institute_id_fkey' },
  { table: 'timetables', constraint: 'timetables_institute_id_fkey' },
  { table: 'events', constraint: 'events_institute_id_fkey' }
];

async function updateConstraints() {
  await c.connect();
  for (const t of tablesToUpdate) {
    try {
      console.log(`Updating ${t.table}...`);
      await c.query(`ALTER TABLE ${t.table} DROP CONSTRAINT IF EXISTS ${t.constraint};`);
      await c.query(`ALTER TABLE ${t.table} ADD CONSTRAINT ${t.constraint} FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE;`);
      console.log(`Successfully updated ${t.table}`);
    } catch (e) {
      console.error(`Failed to update ${t.table}:`, e.message);
    }
  }
  await c.end();
}

updateConstraints();
