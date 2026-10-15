import { SetMetadata } from '@nestjs/common';
import { AdminPermissionModule } from '../common/admin-permission-modules';

export const ADMIN_MODULE_KEY = 'school_admin_module';
export const RequireAdminModule = (module: AdminPermissionModule) => SetMetadata(ADMIN_MODULE_KEY, module);
