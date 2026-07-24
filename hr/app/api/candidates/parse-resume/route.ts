import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { extractResumeText, guessFieldsFromResumeText, sniffResumeType, MAX_RESUME_BYTES } from "@/lib/resume-parse";

export const dynamic = "force-dynamic";
// NOT edge runtime: JSZip's streaming `.async()` uses `setImmediate`
// internally, which the Edge runtime doesn't provide — this route needs the
// default Node.js runtime (same as every other route handler here), which
// OpenNext's `nodejs_compat` flag on Cloudflare fully supports.

// HR-only: upload a candidate's resume, get back a best-effort guess at
// name/email/phone to prefill the Add Candidate form. Nothing is saved here —
// this route only reads the file in memory for the duration of the request and
// returns extracted text fields. The HR user reviews/edits before submitting.
export async function POST(req: Request) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

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
  if (file.size > MAX_RESUME_BYTES) {
    return NextResponse.json({ error: "That file is larger than 8 MB — please upload a smaller resume." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffResumeType(bytes);
  if (!kind) {
    return NextResponse.json({ error: "Please upload a PDF or Word (.docx) resume." }, { status: 400 });
  }

  let text: string;
  try {
    text = await extractResumeText(bytes);
  } catch {
    return NextResponse.json({ error: "Couldn't read that file — it may be corrupted, scanned-image-only, or password protected." }, { status: 422 });
  }
  if (!text || text.trim().length < 20) {
    return NextResponse.json({ error: "Couldn't find readable text in that file — it may be a scanned image rather than a text document." }, { status: 422 });
  }

  const fields = guessFieldsFromResumeText(text);
  return NextResponse.json({ ok: true, fields, fileName: file.name });
}
