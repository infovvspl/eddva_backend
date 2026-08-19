import { DataSource } from 'typeorm';
import { schoolDbConfig } from '../../../config/database.config';
import { ErpModule } from '../entities/erp-module.entity';
import { ErpPermission } from '../entities/erp-permission.entity';

const AppDataSource = new DataSource({ ...schoolDbConfig } as any);

async function runSeed() {
  await AppDataSource.initialize();
  console.log('Connected to eddva_school DB.');

  const moduleRepo = AppDataSource.getRepository(ErpModule);
  const permissionRepo = AppDataSource.getRepository(ErpPermission);

  // 1. Seed Transport Module
  let transportModule = await moduleRepo.findOne({ where: { key: 'transport_management' } });
  if (!transportModule) {
    transportModule = moduleRepo.create({
      name: 'Transport Management',
      key: 'transport_management',
      description: 'Manage routes, vehicles, drivers, and transport fees.',
      path: '/transport',
      icon: 'bus',
      color: '#4F46E5',
      bg: '#EEF2FF',
      is_active: true,
    });
    await moduleRepo.save(transportModule);
    console.log('Created Transport module.');
  } else {
    console.log('Transport module already exists.');
  }

  // 2. Seed Permissions
  const transportPermissions = [
    { key: 'transport.routes.view', name: 'View Routes', description: 'View transport routes' },
    { key: 'transport.routes.create', name: 'Create Routes', description: 'Create transport routes' },
    { key: 'transport.routes.edit', name: 'Edit Routes', description: 'Edit transport routes' },
    { key: 'transport.routes.delete', name: 'Delete Routes', description: 'Delete transport routes' },
    { key: 'transport.vehicles.view', name: 'View Vehicles', description: 'View transport vehicles' },
    { key: 'transport.vehicles.create', name: 'Create Vehicles', description: 'Create transport vehicles' },
    { key: 'transport.drivers.manage', name: 'Manage Drivers', description: 'Manage transport drivers' },
    { key: 'transport.fees.manage', name: 'Manage Fees', description: 'Manage transport fees' },
  ];

  for (const perm of transportPermissions) {
    const existing = await permissionRepo.findOne({ where: { key: perm.key } });
    if (!existing) {
      await permissionRepo.save(
        permissionRepo.create({
          module_id: transportModule.id, // Reference to module
          ...perm,
        }),
      );
      console.log(`Created permission: ${perm.key}`);
    }
  }

  console.log('ERP Seeding completed.');
  await AppDataSource.destroy();
}

runSeed().catch((err) => {
  console.error('Error during seeding:', err);
  process.exit(1);
});
