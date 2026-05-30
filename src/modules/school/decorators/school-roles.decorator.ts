import { SetMetadata } from '@nestjs/common';

export const SCHOOL_ROLES_KEY = 'school_roles';
export const SchoolRoles = (...roles: string[]) => SetMetadata(SCHOOL_ROLES_KEY, roles);
