import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";
import { getLab } from "@/lib/labs";
import { labInstructions } from "@/lib/lab-content";
import { listEntitlements } from "@/lib/server/store";

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
    const entitled = grants.some(
      (e) => (e.labSlug === slug || e.labSlug === "*") && (!e.accessUntil || new Date(e.accessUntil).getTime() > now)
    );
    if (!entitled) return NextResponse.json({ error: "not entitled" }, { status: 403 });
  }

  return NextResponse.json({ walkthrough: walkthroughOf(labInstructions[slug] ?? "") });
}
