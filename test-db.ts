import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkDb() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await ds.initialize();
    console.log("Connected.");
    const columns = await ds.query(`
      SELECT id, type, name FROM school_document_templates WHERE id = '46c7230d-2872-437f-abd7-a5c32cd1d92d'
    `);
    console.log("Template:", columns);
    
    // Check if ID_CARD_STUDENT enum is string or something else
  } catch (err) {
    console.error(err);
  } finally {
    await ds.destroy();
  }
}

checkDb();
