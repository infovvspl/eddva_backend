import { DataSource } from "typeorm";
import { coachingDbConfig } from "../src/config/database.config";

async function run() {
  const ds = new DataSource({
    ...coachingDbConfig,
    synchronize: false,
    logging: false,
  });
  await ds.initialize();
  const rows = await ds.query(`SELECT id, name, subdomain, status, type FROM tenants`);
  console.log("Tenants status list:", rows);
  await ds.destroy();
}

run().catch(console.error);
