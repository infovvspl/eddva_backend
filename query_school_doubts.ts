import { DataSource } from 'typeorm';

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    url: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  });
  await ds.initialize();
  const rows = await ds.query(`SELECT id, question_text, ai_explanation, channel, status FROM student_doubts ORDER BY created_at DESC LIMIT 3`);
  for (const r of rows) {
    console.log("-------------------");
    console.log("ID:", r.id);
    console.log("Q:", r.question_text);
    console.log("Status:", r.status);
    console.log("AI:", r.ai_explanation);
  }
  await ds.destroy();
}

main().catch(console.error);
