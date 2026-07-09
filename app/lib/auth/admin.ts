// Server-only admin gate. Admins are identified by Cognito sub (an opaque UUID —
// no PII), configured via the ADMIN_USER_IDS var (comma-separated). Empty list =
// nobody is admin (safe default).

import type { SessionUser } from "./cognito";

export function isAdmin(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  // Read at CALL time, not module scope: on Cloudflare Workers env vars are
  // injected per-request, so a module-init read can see an empty value and
  // silently lock every admin out.
  const ids = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(user.id);
}
