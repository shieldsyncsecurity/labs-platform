import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { ALLOWED_KYC_TYPES, MAX_KYC_BYTES, type KycDoc } from "@/lib/kyc";

export const dynamic = "force-dynamic";

// List KYC metadata (never bytes) for one employee.
export async function GET(_req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;
  try {
    const data = await hrFetch<{ docs?: KycDoc[] }>(`/hr/employees/${encodeURIComponent(seq)}/docs`);
    return NextResponse.json({ docs: data.docs ?? [] });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load documents." }, { status: 502 });
  }
}

// Upload a KYC document (multipart). Bytes ride as base64 to the engine, which
// stores them encrypted (SSE-KMS in prod) and records the actor in the audit.
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

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach a file." }, { status: 400 });
  }
  if (file.size > MAX_KYC_BYTES) {
    return NextResponse.json({ error: "File is larger than 4 MB." }, { status: 400 });
  }
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_KYC_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Only PDF, JPG, PNG, or WEBP are allowed." }, { status: 400 });
  }

  const kind = String(form.get("kind") ?? "other").trim();
  const label = String(form.get("label") ?? "").trim();
  const base64 = Buffer.from(new Uint8Array(await file.arrayBuffer())).toString("base64");

  try {
    const data = await hrFetch<{ doc?: KycDoc }>(`/hr/employees/${encodeURIComponent(seq)}/docs`, {
      method: "POST",
      timeoutMs: 30000,
      body: { kind, label, fileName: file.name, contentType, base64, actor },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not store the document." }, { status: 502 });
  }
}
