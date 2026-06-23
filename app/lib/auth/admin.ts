// Server-only admin gate. Admins are identified by Cognito sub (an opaque UUID —
// no PII), configured via the ADMIN_USER_IDS var (comma-separated). Empty list =
// nobody is admin (safe default).

import type { SessionUser } from "./cognito";

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isAdmin(user: SessionUser | null | undefined): boolean {
  return !!user && ADMIN_IDS.includes(user.id);
}
