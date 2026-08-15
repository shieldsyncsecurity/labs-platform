import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { getViewer } from "@/lib/server/hr-access";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { MAX_KYC_BYTES } from "@/lib/kyc";
import { buildIssuedPdf, pdfFileName, PdfUnavailableError } from "@/lib/server/pdf";

export const dynamic = "force-dynamic";

// Email a document (PDF) to an employee via the engine's Resend transport. The
// attachment is either server-rendered from an ISSUED snapshot (genId — the
// one-click path) or an uploaded file (fallback/override). The exact sent
// bytes are archived in the encrypted store and the send is audited.
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }
  const to = String(form.get("to") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const genId = String(form.get("genId") ?? "").trim();
  const file = form.get("file");
  if (!to || !subject) return NextResponse.json({ error: "Recipient and subject are required." }, { status: 400 });

  let base64: string;
  let fileName: string;
  let note: string | undefined;
  let cta: { label: string; url: string } | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_KYC_BYTES) {
      return NextResponse.json({ error: "PDF is larger than 4 MB." }, { status: 400 });
    }
    base64 = Buffer.from(new Uint8Array(await file.arrayBuffer())).toString("base64");
    fileName = file.name;
  } else if (genId) {
    try {
      const { pdf, gen, employeeName } = await buildIssuedPdf(req, seq, genId);
      // A payslip PDF IS the pay figures (gross/deductions/net). This route only
      // gated on being signed in, so a documents:write + seeSalary:false grant
      // (the EA preset) could email any employee's slip to an arbitrary inbox —
      // bypassing the seeSalary mask the page/PDF/summary all enforce. Mirror
      // pdf/route.ts: the docType is only known after the snapshot resolves, so
      // the check must live here, not in the URL->permission map.
      if (gen.docType === "payslip") {
        const { isAdmin, access } = await getViewer();
        if (!(isAdmin || access.seeSalary)) {
          return NextResponse.json({ error: "You do not have access to salary information." }, { status: 403 });
        }
      }
      if (pdf.length > MAX_KYC_BYTES) {
        return NextResponse.json({ error: "The rendered PDF exceeds 4 MB — attach a compressed file instead." }, { status: 400 });
      }
      base64 = Buffer.from(pdf).toString("base64");
      fileName = pdfFileName(gen, employeeName);
      if (gen.docType === "internship-offer" || gen.docType === "offer") {
        note =
          "This is a digital copy for your reference only. You will receive and sign the original at the office on your joining date. Please confirm below that you have seen and agree to it.";
        cta = { label: "I Accept This Offer", url: `${process.env.APP_URL ?? new URL(req.url).origin}/accept/${seq}/${genId}` };
      }
    } catch (err) {
      if (err instanceof PdfUnavailableError) {
        return NextResponse.json(
          { error: "Server-side PDF isn't available in dev — attach the printed PDF instead." },
          { status: 501 },
        );
      }
      return NextResponse.json({ error: "Could not render the document to PDF." }, { status: 502 });
    }
  } else {
    return NextResponse.json({ error: "Attach the PDF to send." }, { status: 400 });
  }
  try {
    const data = await hrFetch(`/hr/email`, {
      method: "POST",
      timeoutMs: 30000,
      body: { toEmail: to, subject, fileName, base64, employeeSeq: Number(seq), actor, note, cta },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError) {
      const code = (err.body as { error?: string })?.error;
      if (code === "PDF_ONLY") return NextResponse.json({ error: "Only PDF attachments can be sent." }, { status: 400 });
      if (code === "BAD_EMAIL") return NextResponse.json({ error: "That email address doesn't look valid." }, { status: 400 });
      if (code === "EMAIL_NOT_CONFIGURED") {
        return NextResponse.json({ error: "Email isn't configured yet (RESEND_API_KEY)." }, { status: 503 });
      }
    }
    return NextResponse.json({ error: "Could not send the email." }, { status: 502 });
  }
}
