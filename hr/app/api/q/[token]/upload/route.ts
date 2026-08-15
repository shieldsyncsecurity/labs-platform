import { NextResponse } from "next/server";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { MAX_KYC_BYTES, ALLOWED_KYC_TYPES } from "@/lib/kyc";

export const dynamic = "force-dynamic";

// PUBLIC (token-authenticated) upload of the candidate's salary proof.
// This is an unauthenticated write of BINARY data, so it is deliberately
// narrow: one file, size-capped, type-checked here AND magic-byte sniffed in
// the engine, refused once the candidate has submitted, and it can only ever
// attach to the single candidate the token belongs to.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Please choose a file." }, { status: 400 });
  }
  if (file.size > MAX_KYC_BYTES) {
    return NextResponse.json({ error: "That file is larger than 4 MB. Please upload a smaller scan or photo." }, { status: 400 });
  }
  if (file.type && !ALLOWED_KYC_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Please upload a PDF, JPG or PNG." }, { status: 400 });
  }

  const base64 = Buffer.from(new Uint8Array(await file.arrayBuffer())).toString("base64");
  try {
    const out = await hrFetch<{ salaryProofName: string }>(`/hr/questionnaire/${encodeURIComponent(token)}/upload`, {
      method: "POST",
      body: { base64, fileName: file.name },
      timeoutMs: 30000,
    });
    return NextResponse.json({ ok: true, fileName: out.salaryProofName });
  } catch (err) {
    if (err instanceof HrEngineError) {
      if (err.status === 409) return NextResponse.json({ error: "You have already submitted this form." }, { status: 409 });
      if (err.status === 410) return NextResponse.json({ error: "This link has expired." }, { status: 410 });
      if (err.status === 404) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
      if (err.status === 400) return NextResponse.json({ error: "That file couldn't be read. Please upload a PDF, JPG or PNG under 4 MB." }, { status: 400 });
    }
    return NextResponse.json({ error: "Upload failed. Please try again in a moment." }, { status: 502 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    await hrFetch(`/hr/questionnaire/${encodeURIComponent(token)}/upload`, { method: "DELETE" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 409) {
      return NextResponse.json({ error: "You have already submitted this form." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not remove the file." }, { status: 502 });
  }
}
