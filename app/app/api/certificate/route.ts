import { NextResponse } from "next/server";
import { listCompletions } from "@/lib/server/store";
import { getServerUser } from "@/lib/auth/session";
import { getLab } from "@/lib/labs";

// F3: serves the fields the certificate component needs for one lab —
// {credentialId, name, labSlug, labTitle, completedAt}. Gated to an ACTUAL
// completion: only the verified session's own completions are consulted
// (never a client-supplied userId/name), and a lab with no completion row (or
// one whose credentialId hasn't been stamped yet — pre-F3 rows) returns 404.
// This is the only way the app hands out a credentialId to the client, so a
// learner can't mint a certificate for a lab they haven't passed.
export async function GET(req: Request) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const labSlug = new URL(req.url).searchParams.get("labSlug") ?? "";
  const lab = getLab(labSlug);
  if (!lab) return NextResponse.json({ error: "unknown lab" }, { status: 404 });

  const completions = await listCompletions(user.id);
  const row = completions.find((c) => c.labSlug === labSlug);
  if (!row || !row.credentialId) {
    return NextResponse.json({ error: "not completed" }, { status: 404 });
  }

  return NextResponse.json({
    credentialId: row.credentialId,
    name: user.name || "",
    labSlug: lab.slug,
    labTitle: lab.title,
    completedAt: row.firstCompletedAt,
  });
}
