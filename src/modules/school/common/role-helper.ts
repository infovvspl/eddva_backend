/**
 * A user's `role` column can hold more than one role as a comma-joined string
 * (e.g. "TEACHER,INSTITUTE_ADMIN" for someone who does both jobs at a small
 * school). `user.role === 'TEACHER'` is always false for such a user, which
 * silently skips whatever role-scoped logic depended on it — often falling
 * through to "no restriction" rather than an error, so the bug reads as a
 * data-scoping leak rather than a crash. Use this wherever a single role is
 * being checked, the same way SchoolRolesGuard already does for route access.
 */
export function hasSchoolRole(userRole: string | null | undefined, role: string): boolean {
  return String(userRole || '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .includes(role.toUpperCase());
}
