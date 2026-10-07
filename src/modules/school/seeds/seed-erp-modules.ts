import { DataSource } from 'typeorm';
import { schoolDbConfig } from '../../../config/database.config';
import { ErpModule } from '../entities/erp-module.entity';

const AppDataSource = new DataSource({ ...schoolDbConfig } as any);

/**
 * The full catalogue of real ERP modules (eddva_erp_backend / eddva_erp_frontend).
 * `key` matches each module's SSO path segment (e.g. `/accounts/auth/sso`), so
 * Step 4's module-enabled check can derive it directly from the SSO path with
 * no separate mapping table. `path` matches the ERP frontend's route prefix
 * (navConfig.ts) and `sort_order` follows that file's existing nav order.
 */
const MODULES = [
  { key: 'sales-purchase', name: 'Sales & Purchase', description: 'Vendors, customers, purchase/sales orders, invoices and GRNs.', path: '/sales-purchase', icon: 'shopping-cart', sort_order: 10 },
  { key: 'canteen', name: 'Canteen Management', description: 'Menu, POS orders, wallets and canteen memberships.', path: '/canteen', icon: 'utensils', sort_order: 20 },
  { key: 'admission', name: 'Admission', description: 'Enquiries, applications, entrance tests, offers and confirmations.', path: '/admission', icon: 'graduation-cap', sort_order: 30 },
  { key: 'hostel', name: 'Hostel', description: 'Rooms, allotments, mess, fees and hostel discipline records.', path: '/hostel', icon: 'home', sort_order: 40 },
  { key: 'alumni', name: 'Alumni', description: 'Alumni directory, events, jobs, mentorship and fundraising.', path: '/alumni', icon: 'graduation-cap', sort_order: 50 },
  { key: 'library', name: 'Library', description: 'Book catalogue, issues/returns, reservations and fines.', path: '/library', icon: 'book-open', sort_order: 60 },
  { key: 'front-office', name: 'Front Office', description: 'Visitors, enquiries, appointments and complaints.', path: '/front-office', icon: 'building', sort_order: 70 },
  { key: 'sports', name: 'Sports', description: 'Sports, houses, tournaments, fixtures and records.', path: '/sports', icon: 'trophy', sort_order: 80 },
  { key: 'inventory', name: 'Inventory', description: 'Stock, assets, vendors and approval workflows.', path: '/inventory', icon: 'boxes', sort_order: 90 },
  { key: 'transport', name: 'Transport', description: 'Vehicles, routes, drivers, GPS tracking and transport fees.', path: '/transport', icon: 'bus', sort_order: 100 },
  { key: 'accounts', name: 'Accounts', description: 'Chart of accounts, vouchers, ledgers and financial reports.', path: '/accounts', icon: 'wallet', sort_order: 110 },
] as const;

const COLOR = '#008BE9';
const BG = '#EAF4FD';

async function runSeed() {
  await AppDataSource.initialize();
  console.log('Connected to eddva_school DB.');

  const moduleRepo = AppDataSource.getRepository(ErpModule);

  for (const m of MODULES) {
    const existing = await moduleRepo.findOne({ where: { key: m.key } });
    if (existing) {
      await moduleRepo.update(existing.id, {
        name: m.name,
        description: m.description,
        path: m.path,
        icon: m.icon,
        color: COLOR,
        bg: BG,
        sort_order: m.sort_order,
        is_active: true,
      });
      console.log(`Updated module: ${m.key}`);
    } else {
      await moduleRepo.save(
        moduleRepo.create({
          key: m.key,
          name: m.name,
          description: m.description,
          path: m.path,
          icon: m.icon,
          color: COLOR,
          bg: BG,
          sort_order: m.sort_order,
          is_active: true,
        }),
      );
      console.log(`Created module: ${m.key}`);
    }
  }

  console.log('ERP module catalogue seeding completed.');
  await AppDataSource.destroy();
}

runSeed().catch((err) => {
  console.error('Error during seeding:', err);
  process.exit(1);
});
