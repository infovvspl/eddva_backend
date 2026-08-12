import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function check() {
  await AppDataSource.initialize();
  const rows = await AppDataSource.query(`SELECT id, name, type, LENGTH(html_content) as len FROM school_document_templates`);
  console.log("Templates:", rows);
  await AppDataSource.destroy();
}

check().catch(console.error);
