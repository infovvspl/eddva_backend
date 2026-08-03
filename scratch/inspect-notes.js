const { DataSource } = require('typeorm');
const dotenv = require('dotenv');

dotenv.config({ path: '.env' });

const schoolDs = new DataSource({
  name: 'school',
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await schoolDs.initialize();
  
  console.log('Searching school_ai_study_sessions for math formulas...');
  const rows = await schoolDs.query(`
    SELECT id, topic_id, lesson_markdown, formulas, key_concepts 
    FROM school_ai_study_sessions
  `);
  
  for (const row of rows) {
    if (row.lesson_markdown && (
      row.lesson_markdown.includes('Powers') || 
      row.lesson_markdown.includes('Product of Powers') ||
      row.lesson_markdown.includes('a^m')
    )) {
      console.log(`Found session id: ${row.id}`);
      console.log('Formulas field:', row.formulas);
      console.log('Lesson Markdown slice:', row.lesson_markdown.slice(0, 1000));
    }
  }

  await schoolDs.destroy();
}

run().catch(console.error);
