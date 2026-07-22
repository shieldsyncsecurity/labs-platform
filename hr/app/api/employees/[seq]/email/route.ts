import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { MAX_KYC_BYTES } from "@/lib/kyc";

export const dynamic = "force-dynamic";

// Email a document (PDF) to an employee via the engine's Resend transport. The
// exact sent bytes are archived in the encrypted store and the send is audited.
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
  const file = form.get("file");
  if (!to || !subject) return NextResponse.json({ error: "Recipient and subject are required." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the PDF to send." }, { status: 400 });
  }
  if (file.size > MAX_KYC_BYTES) {
    return NextResponse.json({ error: "PDF is larger than 4 MB." }, { status: 400 });
  }

  const base64 = Buffer.from(new Uint8Array(await file.arrayBuffer())).toString("base64");
  try {
    const data = await hrFetch(`/hr/email`, {
      method: "POST",
      timeoutMs: 30000,
      body: { toEmail: to, subject, fileName: file.name, base64, employeeSeq: Number(seq), actor },
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
