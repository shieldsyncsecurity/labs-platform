import { NextResponse } from "next/server";

// Public, unauthenticated: grades the /demo/try mini-assessment. Stateless and
// persistence-free — the browser sends the sandbox's final state, this route
// returns per-objective results computed with the SAME policy-document-analysis
// style the real grading engine uses (wildcard detection, root-cause-vs-mask,
// legitimate-statements-preserved, workload-still-works). Keeping the analysis
// server-side keeps the demo honest ("graded server-side, not in your browser")
// and the logic out of the client bundle.
//
// This is DEMO grading over a fixed, seeded scenario — it never touches the
// engine, AWS, or any table. Real assessments grade live AWS account state.

type GradeBody = {
  accountBpa?: boolean;
  bucketBpa?: boolean;
  /** Bucket policy JSON for the data bucket, or null if the visitor deleted it. */
  dataPolicy?: string | null;
  /** IAM policy JSON currently attached to the pipeline user. */
  userPolicy?: string | null;
};

type Statement = {
  Effect?: string;
  Principal?: unknown;
  Action?: string | string[];
  Resource?: string | string[];
  Condition?: Record<string, unknown>;
};

const DATA_BUCKET_ARN = "arn:aws:s3:::sslab-data-demo";

const asArray = (x: unknown): unknown[] => (Array.isArray(x) ? x : x == null ? [] : [x]);

function parsePolicy(doc: string | null | undefined): { Statement?: Statement[] } | null {
  if (!doc) return null;
  try {
    const p = JSON.parse(doc);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

function statements(policy: { Statement?: Statement[] } | null): Statement[] {
  return policy ? (asArray(policy.Statement) as Statement[]) : [];
}

// Does any Allow statement open the resource to everyone? (Principal "*" / {"AWS":"*"})
function hasPublicAllow(policy: { Statement?: Statement[] } | null): boolean {
  return statements(policy).some((st) => {
    if (st.Effect !== "Allow") return false;
    const p = st.Principal as { AWS?: unknown } | string | undefined;
    return p === "*" || (typeof p === "object" && p !== null && asArray(p.AWS).includes("*"));
  });
}

// The seeded legitimate control: a Deny on non-TLS requests. Deleting the whole
// policy "fixes" the public grant but destroys this — root-cause credit requires both.
function hasTlsDeny(policy: { Statement?: Statement[] } | null): boolean {
  return statements(policy).some(
    (st) =>
      st.Effect === "Deny" &&
      JSON.stringify(st.Condition ?? {}).toLowerCase().includes("aws:securetransport"),
  );
}

// Same shape as the engine's allowsActionOnStar: an Allow granting a wildcard
// action on Resource "*".
function allowsWildcardOnStar(policy: { Statement?: Statement[] } | null): boolean {
  return statements(policy).some(
    (st) =>
      st.Effect === "Allow" &&
      asArray(st.Resource).some((r) => r === "*") &&
      asArray(st.Action).some((a) => a === "s3:*" || a === "*"),
  );
}

// Every Allow statement is s3-only and scoped to the demo buckets' ARNs.
function scopedToLabArns(policy: { Statement?: Statement[] } | null): boolean {
  const sts = statements(policy).filter((st) => st.Effect === "Allow");
  if (sts.length === 0) return false;
  return sts.every(
    (st) =>
      asArray(st.Action).every((a) => typeof a === "string" && a.startsWith("s3:") && a !== "s3:*") &&
      asArray(st.Resource).every(
        (r) => typeof r === "string" && r.startsWith("arn:aws:s3:::sslab-"),
      ),
  );
}

// Would the pipeline still work? It needs GetObject + PutObject on the data
// bucket. Mirrors the engine's grantsRead pattern: accept exact action, s3:*
// or *, on a resource that covers the bucket (ARN prefix or "*").
function pipelineWorks(policy: { Statement?: Statement[] } | null): { ok: boolean; reason: string } {
  const grants = (needed: string) =>
    statements(policy).some(
      (st) =>
        st.Effect === "Allow" &&
        asArray(st.Action).some((a) => a === needed || a === "s3:*" || a === "*") &&
        asArray(st.Resource).some(
          (r) => r === "*" || (typeof r === "string" && r.startsWith(DATA_BUCKET_ARN)),
        ),
    );
  if (!policy) return { ok: false, reason: "The pipeline user has no policy attached — every call is denied." };
  if (!grants("s3:GetObject")) return { ok: false, reason: "The pipeline can no longer READ the data bucket (s3:GetObject is not granted)." };
  if (!grants("s3:PutObject")) return { ok: false, reason: "The pipeline can no longer WRITE results (s3:PutObject is not granted)." };
  return { ok: true, reason: "Processor ran: read input, wrote results. The pipeline still works." };
}

export async function POST(req: Request) {
  let body: GradeBody;
  try {
    const raw = await req.text();
    if (raw.length > 20_000) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const accountBpa = body.accountBpa === true;
  const bucketBpa = body.bucketBpa === true;
  const dataPolicy = typeof body.dataPolicy === "string" ? parsePolicy(body.dataPolicy) : null;
  const dataPolicyDeleted = body.dataPolicy == null;
  const userPolicy = typeof body.userPolicy === "string" ? parsePolicy(body.userPolicy) : null;

  const publicGone = dataPolicyDeleted ? true : !hasPublicAllow(dataPolicy);
  const legitKept = dataPolicyDeleted ? false : hasTlsDeny(dataPolicy);
  const bpaOn = accountBpa || bucketBpa;

  const wildcardGone = userPolicy !== null && !allowsWildcardOnStar(userPolicy);
  const scoped = scopedToLabArns(userPolicy);
  const canary = pipelineWorks(userPolicy);

  const objectives = [
    {
      id: "public-exposure",
      title: "Public exposure removed at the root",
      subChecks: [
        { id: "bpa", label: "Block Public Access enabled" + (accountBpa ? " (account-wide)" : bucketBpa ? " (bucket only)" : ""), passed: bpaOn },
        { id: "root-cause", label: "Public-read policy statement removed — not just masked", passed: publicGone },
        { id: "legit-kept", label: "Legitimate TLS-only protection preserved", passed: legitKept },
      ],
    },
    {
      id: "least-privilege",
      title: "Pipeline user right-sized to least privilege",
      subChecks: [
        { id: "wildcard", label: "Wildcard grant (s3:* on all resources) removed", passed: wildcardGone },
        { id: "scoped", label: "Actions scoped to the pipeline's buckets only", passed: scoped },
      ],
    },
    {
      id: "app-preserved",
      title: "The pipeline still works after your changes",
      subChecks: [{ id: "canary", label: canary.reason, passed: canary.ok }],
    },
  ].map((o) => {
    const per = o.id === "app-preserved" ? 10 : 10;
    const earned = o.subChecks.filter((c) => c.passed).length * per;
    const max = o.subChecks.length * per;
    return { ...o, earned, max, passed: earned === max };
  });

  const score = objectives.reduce((s, o) => s + o.earned, 0);
  const max = objectives.reduce((s, o) => s + o.max, 0);

  return NextResponse.json({ objectives, score, max, canary });
}
