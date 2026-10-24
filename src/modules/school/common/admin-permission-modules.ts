// Grantable admin-panel module keys, 1:1 with the admin nav items in
// eddva_frontend/src/components/school/admin/Sidebar.jsx's buildInstituteGroups
// (keep both lists in sync by hand — frontend and backend are separate projects).
// "Dashboard" is always visible and not gated; "Administrators" is deliberately
// excluded — managing admin access is permanently primary-admin/SUPER_ADMIN-only.
export const ADMIN_PERMISSION_MODULES = [
  'students',
  'teachers',
  'academics',
  'subjects',
  'competitive_exam_prep',
  'syllabus_planner',
  'syllabus_tracker',
  'attendance',
  'timetable',
  'academic_calendar',
  'notices',
  'communications',
  'erp',
  'user_management',
  'document_generator',
  'audit_logs',
  'complaints',
  'screen_time',
  'emergency_sos',
] as const;

export type AdminPermissionModule = typeof ADMIN_PERMISSION_MODULES[number];

export function isValidAdminPermissionModule(key: string): key is AdminPermissionModule {
  return (ADMIN_PERMISSION_MODULES as readonly string[]).includes(key);
}
