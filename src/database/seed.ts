import { DataSource } from 'typeorm';
import { dbConfig } from '../config/database.config';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { Tenant, TenantType, TenantStatus, TenantPlan } from './entities/tenant.entity';

async function seed() {
  const dataSource = new DataSource(dbConfig);

  try {
    await dataSource.initialize();
    console.log('Data Source has been initialized!');

    const tenantRepo = dataSource.getRepository(Tenant);
    const userRepo = dataSource.getRepository(User);

    // 1. Find or Create Platform Tenant
    let platformTenant = await tenantRepo.findOne({ where: { type: TenantType.PLATFORM } });
    
    if (!platformTenant) {
      console.log('Platform tenant not found, creating...');
      platformTenant = tenantRepo.create({
        name: 'APEXIQ Platform',
        subdomain: 'platform',
        type: TenantType.PLATFORM,
        status: TenantStatus.ACTIVE,
        plan: TenantPlan.PLATFORM,
        maxStudents: 1000000,
        maxTeachers: 1000000,
      });
      await tenantRepo.save(platformTenant);
    }
    console.log(`Using Platform Tenant: ${platformTenant.id}`);

    // 2. Create Super Admin User (E.164 phone matches frontend + /auth/login lookup)
    const superAdminEmail = 'superadmin@gmail.com';
    const superAdminPhone = '+919999999999';

    let superAdmin = await userRepo.findOne({
      where: [
        { email: superAdminEmail },
        { phoneNumber: superAdminPhone },
        { phoneNumber: '9999999999' }, // legacy seed — upgraded below
      ],
    });

    if (!superAdmin) {
      console.log('Super Admin not found, creating...');
      superAdmin = userRepo.create({
        tenantId: platformTenant.id,
        fullName: 'Super Admin',
        email: superAdminEmail,
        phoneNumber: superAdminPhone,
        password: 'Admin@123', // Will be hashed by @BeforeInsert
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        phoneVerified: true,
        isFirstLogin: false,
      });
      await userRepo.save(superAdmin);
      console.log('Super Admin created successfully!');
    } else {
      console.log('Super Admin already exists, updating credentials...');
      superAdmin.fullName = 'Super Admin';
      superAdmin.phoneNumber = superAdminPhone;
      superAdmin.password = 'Admin@123'; // Triggers @BeforeUpdate hook to re-hash
      superAdmin.role = UserRole.SUPER_ADMIN;
      superAdmin.status = UserStatus.ACTIVE;
      superAdmin.phoneVerified = true;
      superAdmin.isFirstLogin = false;
      await userRepo.save(superAdmin);
      console.log('Super Admin updated successfully!');
    }

  } catch (error) {
    console.error('Error during seeding:', error);
  } finally {
    await dataSource.destroy();
  }
}

seed();
