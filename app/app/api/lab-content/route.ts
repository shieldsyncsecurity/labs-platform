import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";
import { getLab } from "@/lib/labs";
import { labInstructions } from "@/lib/lab-content";
import { listEntitlements, entitlementTypeOf } from "@/lib/server/store";

// Serves the GATED walkthrough (the part after the "<!-- ss:walkthrough -->" sentinel)
// for PAID labs. The page only ever ships the public overview; the walkthrough — which
// includes step-by-step answers and any capture flag — is fetched here and only returned
// to a signed-in, ENTITLED user (or anyone for a free lab). This keeps paid content out
// of the public static bundle entirely.
function walkthroughOf(md: string): string {
  const m = md.match(/<!--\s*ss:walkthrough\s*-->/);
  if (m && m.index != null) return md.slice(m.index + m[0].length);
  const step = md.search(/^##\s+Step\b/m);
  return step >= 0 ? md.slice(step) : "";
}

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return NextResponse.json({ error: "bad slug" }, { status: 400 });
  }
  const lab = getLab(slug);
  if (!lab || !lab.ready) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Free lab walkthrough is public content; paid requires a signed-in, entitled user.
  if (!lab.free) {
    const user = await getServerUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const now = Date.now();
    const grants = await listEntitlements(user.id);
    const matched = grants.find(
      (e) => (e.labSlug === slug || e.labSlug === "*") && (!e.accessUntil || new Date(e.accessUntil).getTime() > now)
    );
    if (!matched) return NextResponse.json({ error: "not entitled" }, { status: 403 });

    // PAY_PER_LAB: enforce the 7-day window and 3-launch cap (mirrors launch/route.ts).
    // Without this check, a user whose per-lab grant has expired or exhausted its
    // launch cap can still retrieve the paid walkthrough via this route.
    const etype = entitlementTypeOf(matched);
    if (etype === "PAY_PER_LAB") {
      if (matched.windowExpiresAt && new Date(matched.windowExpiresAt).getTime() <= now) {
        return NextResponse.json({ error: "WINDOW_EXPIRED" }, { status: 403 });
      }
      const used = matched.launchCount ?? 0;
      const cap = matched.maxLaunches ?? 0;
      if (cap > 0 && used >= cap) {
        return NextResponse.json({ error: "LAUNCH_CAP_REACHED" }, { status: 403 });
      }
    }
  }

  return NextResponse.json({ walkthrough: walkthroughOf(labInstructions[slug] ?? "") });
}
