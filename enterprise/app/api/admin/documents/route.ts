import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor, getAdminSession } from "@/lib/server/admin-session";

// Staff-only: register a document for signing (POST, multipart) + list
// registered documents (GET, token-stripped display rows).
//
// TOKEN HANDLING CONTRACT: the full signing link is returned ONCE, from the
// register POST, for the staff user to copy/send. The GET list NEVER includes
// docTokens -- rows carry an 8-char display id only, and every follow-up
// action (resend/revoke/certificate) resolves that display id back to the
// token SERVER-side (see ./action). Losing the link is recoverable via
// "Resend link email" or by revoking + re-registering.

const MAX_PDF_BYTES = 4 * 1024 * 1024; // must match the engine's cap

export type DocDisplayRow = {
  id: string;
  title: string;
  fileName: string;
  signerName: string;
  signerEmail: string;
  note: string;
  status: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedName?: string;
  revokedAt?: string;
};

type EngineDoc = DocDisplayRow & { docToken?: string };

function hexToken(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function GET() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const data = await entFetch<{ docs?: EngineDoc[] }>("/ent/docs");
    // Strip tokens BEFORE anything leaves this route -- display ids only.
    const docs: DocDisplayRow[] = (data.docs ?? []).map((d) => ({
      id: (d.docToken ?? "").slice(0, 8),
      title: d.title ?? "",
      fileName: d.fileName ?? "",
      signerName: d.signerName ?? "",
      signerEmail: d.signerEmail ?? "",
      note: d.note ?? "",
      status: d.status ?? "",
      sizeBytes: d.sizeBytes ?? 0,
      sha256: d.sha256 ?? "",
      createdAt: d.createdAt ?? "",
      expiresAt: d.expiresAt ?? "",
      acceptedAt: d.acceptedAt,
      acceptedName: d.acceptedName,
      revokedAt: d.revokedAt,
    }));
    return NextResponse.json({ docs });
  } catch (err) {
    console.error("[api/admin/documents] list failed", err);
    return NextResponse.json({ error: "Could not load documents." }, { status: 502 });
  }
}

export async function POST(req: Request) {
  // Mutation => actor-shaped gate (fail-closed; the email lands in the audit).
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the PDF to register." }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF is larger than 4 MB." }, { status: 400 });
  }
  const title = String(form.get("title") ?? "").trim();
  const signerName = String(form.get("signerName") ?? "").trim();
  const signerEmail = String(form.get("signerEmail") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const expiresDays = Number(form.get("expiresDays") ?? 30);
  const sendLink = form.get("sendLink") === "on" || form.get("sendLink") === "true";
  if (!title) return NextResponse.json({ error: "Give the document a title." }, { status: 400 });
  if (!signerEmail) {
    return NextResponse.json({ error: "The signer's email is required (the acceptance code goes there)." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfBase64 = Buffer.from(bytes).toString("base64");
  const docToken = hexToken();

  try {
    const doc = await entFetch<{ sha256?: string; expiresAt?: string; emailed?: boolean }>("/ent/docs", {
      method: "POST",
      // Base64 of up to 4MB rides in this one call -- give it extra headroom.
      timeoutMs: 30000,
      body: {
        docToken,
        title,
        fileName: file.name,
        signerName,
        signerEmail,
        note,
        expiresDays,
        pdfBase64,
        sendLink,
        actor,
      },
    });
    const appUrl = (process.env.APP_URL ?? "https://enterprise.shieldsyncsecurity.com").replace(/\/+$/, "");
    // The ONE-TIME full-link disclosure (see contract at the top of this file).
    return NextResponse.json({
      ok: true,
      link: `${appUrl}/sign/${docToken}`,
      displayId: docToken.slice(0, 8),
      sha256: doc.sha256,
      expiresAt: doc.expiresAt,
      emailed: doc.emailed === true,
    });
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/admin/documents] register failed", err.status, err.body);
      const b = (err.body ?? {}) as { error?: string };
      if (b.error === "PDF_INVALID") {
        return NextResponse.json({ error: "That file isn't a valid PDF." }, { status: 400 });
      }
      if (b.error === "PDF_TOO_LARGE") {
        return NextResponse.json({ error: "PDF is larger than 4 MB." }, { status: 400 });
      }
      if (b.error === "SIGNER_EMAIL_INVALID") {
        return NextResponse.json({ error: "That signer email doesn't look valid." }, { status: 400 });
      }
    }
    console.error("[api/admin/documents] register error", err);
    return NextResponse.json({ error: "Could not register the document." }, { status: 502 });
  }
}
