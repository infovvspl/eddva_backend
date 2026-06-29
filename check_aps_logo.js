const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

async function inspect() {
  const schoolDbUrl = process.env.SCHOOL_DB_URL;
  if (!schoolDbUrl) {
    console.error('SCHOOL_DB_URL is not defined in .env');
    return;
  }
  const client = new Client({
    connectionString: schoolDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query('SELECT id, name, logo, tenant_domain FROM public.institutes');
    res.rows.forEach(r => {
      const logoPrefix = r.logo ? r.logo.substring(0, 100) : 'null';
      console.log(`ID: ${r.id} | NAME: "${r.name}" | DOMAIN: "${r.tenant_domain}" | LOGO PREFIX: "${logoPrefix}"`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

inspect();
