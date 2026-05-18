import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function run() {
    const client = new Client({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    try {
        await client.connect();
        console.log('Connected to DB');

        const queries = [
            "ALTER TYPE resource_type_enum ADD VALUE IF NOT EXISTS 'mindmap'",
            "ALTER TYPE study_material_type_enum ADD VALUE IF NOT EXISTS 'mindmap'",
            "ALTER TYPE topic_resources_type_enum ADD VALUE IF NOT EXISTS 'mindmap'"
        ];

        for (const q of queries) {
            try {
                await client.query(q);
                console.log(`Success: ${q}`);
            } catch (e: any) {
                if (e.code === '42710') { // duplicate_object
                    console.log(`Already exists: ${q}`);
                } else if (e.code === '42704') { // undefined_object
                    console.log(`Type does not exist, skipping: ${q}`);
                } else {
                    console.error(`Failed: ${q}`, e);
                }
            }
        }

        console.log('Enum update process completed');
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
