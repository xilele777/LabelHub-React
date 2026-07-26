import { Role } from '../types';

export function normalizeRole(role: Role | string | null | undefined): Role | null {
  if (!role) return null;
  if (role === Role.ADMIN || role === Role.OWNER) return Role.ADMIN;
  if (role === Role.ANNOTATOR) return Role.ANNOTATOR;
  if (role === Role.REVIEWER) return Role.REVIEWER;
  return null;
}

export function hasRouteRole(
  currentRole: Role | string | null | undefined,
  requiredRoles: Role[],
): boolean {
  const normalizedCurrent = normalizeRole(currentRole);
  if (!normalizedCurrent) return false;

  return requiredRoles.some((role) => normalizeRole(role) === normalizedCurrent);
}

export function getDefaultPath(role: Role | string): string {
  switch (normalizeRole(role)) {
    case Role.ADMIN:
    case Role.OWNER:
      return '/dashboard';
    case Role.ANNOTATOR:
      return '/annotate';
    case Role.REVIEWER:
      return '/review';
    default:
      return '/dashboard';
  }
}
