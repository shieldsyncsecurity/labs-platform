import { NextResponse } from "next/server";
import { getSelfSession } from "@/lib/server/self-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { MAX_KYC_BYTES } from "@/lib/kyc";
import { buildIssuedPdf, pdfFileName, PdfUnavailableError } from "@/lib/server/pdf";

export const dynamic = "force-dynamic";

// Self-serve email — she can send her OWN issued document to any address she
// chooses (herself, a future employer, whoever). seq comes from the signed
// ss_self session, never from the request body, so this can only ever attach
// a document that belongs to whoever is signed in.
export async function POST(req: Request) {
  const session = await getSelfSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }
  const to = String(form.get("to") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const genId = String(form.get("genId") ?? "").trim();
  if (!to || !subject || !genId) return NextResponse.json({ error: "Recipient, subject, and document are required." }, { status: 400 });

  try {
    const { pdf, gen, employeeName } = await buildIssuedPdf(req, String(session.seq), genId);
    if (pdf.length > MAX_KYC_BYTES) {
      return NextResponse.json({ error: "The rendered PDF exceeds 4 MB." }, { status: 400 });
    }
    const data = await hrFetch("/hr/email", {
      method: "POST",
      timeoutMs: 30000,
      body: {
        toEmail: to,
        subject,
        fileName: pdfFileName(gen, employeeName),
        base64: Buffer.from(pdf).toString("base64"),
        employeeSeq: session.seq,
        actor: "self-serve",
      },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      return NextResponse.json({ error: "Email isn't available in dev — use Download instead." }, { status: 501 });
    }
    if (err instanceof HrEngineError) {
      const code = (err.body as { error?: string })?.error;
      if (code === "PDF_ONLY") return NextResponse.json({ error: "Only PDF attachments can be sent." }, { status: 400 });
      if (code === "BAD_EMAIL") return NextResponse.json({ error: "That email address doesn't look valid." }, { status: 400 });
      if (code === "EMAIL_NOT_CONFIGURED") return NextResponse.json({ error: "Email isn't configured yet." }, { status: 503 });
      if (err.status === 404) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not send the email." }, { status: 502 });
  }
}
