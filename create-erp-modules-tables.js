const { DataSource } = require('typeorm');
require('dotenv').config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await ds.initialize();
  
  await ds.query(`
    CREATE TABLE IF NOT EXISTS school_erp_modules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      path VARCHAR(255),
      icon VARCHAR(100) NOT NULL,
      color VARCHAR(50) NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await ds.query(`
    CREATE TABLE IF NOT EXISTS school_erp_module_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL,
      module_id UUID NOT NULL REFERENCES school_erp_modules(id) ON DELETE CASCADE,
      is_active BOOLEAN DEFAULT true,
      enabled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(school_id, module_id)
    );
  `);

  // Seed default modules
  const rolesCheck = await ds.query(`SELECT id FROM school_erp_modules WHERE key = 'roles_permissions'`);
  if (rolesCheck.length === 0) {
    await ds.query(`
      INSERT INTO school_erp_modules (key, name, description, path, icon, color, sort_order)
      VALUES ('roles_permissions', 'Roles & Permissions', 'Manage user roles and permissions', '/school/admin/roles', 'Shield', 'indigo', 1)
    `);
  }

  const salesCheck = await ds.query(`SELECT id FROM school_erp_modules WHERE key = 'sales_purchase'`);
  if (salesCheck.length === 0) {
    await ds.query(`
      INSERT INTO school_erp_modules (key, name, description, path, icon, color, sort_order)
      VALUES ('sales_purchase', 'Sales & Purchase', 'Manage sales and purchases', null, 'TrendingUp', 'emerald', 2)
    `);
  }

  console.log("ERP Module tables created and seeded successfully.");
  await ds.destroy();
}

run().catch(console.error);
