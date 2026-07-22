"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KYC_KINDS, kindLabel, humanSize, type KycDoc } from "@/lib/kyc";

const input: React.CSSProperties = { padding: "7px 9px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6, background: "#fff" };
const btn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };

export function KycSection({ seq }: { seq: string }) {
  const [docs, setDocs] = useState<KycDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees/${seq}/docs`);
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "Could not load documents.");
      setDocs(data.docs ?? []);
    } catch {
      setError("Could not reach the HR engine.");
    }
  }, [seq]);

  useEffect(() => {
    load();
  }, [load]);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${seq}/docs`, { method: "POST", body: new FormData(e.currentTarget) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
      } else {
        formRef.current?.reset();
        await load();
      }
    } catch {
      setError("Upload failed.");
    }
    setBusy(false);
  }

  async function onDelete(docId: string, name: string) {
    if (!confirm(`Delete "${name}"? This permanently removes the file. The deletion is logged.`)) return;
    await fetch(`/api/employees/${seq}/docs/${docId}`, { method: "DELETE" });
    await load();
  }

  return (
    <div style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14 }}>KYC documents</div>
        <div style={{ fontSize: 10.5, color: "#8a94a3" }}>🔒 Encrypted at rest · access logged</div>
      </div>

      {error ? (
        <div style={{ background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>{error}</div>
      ) : null}

      <form ref={formRef} onSubmit={onUpload} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <select name="kind" style={input} defaultValue="aadhaar">
          {KYC_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
        <input name="label" placeholder="Note (optional)" style={{ ...input, flex: 1, minWidth: 120 }} />
        <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" style={{ fontSize: 12 }} />
        <button type="submit" disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy ? "Uploading…" : "Upload"}</button>
      </form>
      <div style={{ fontSize: 10.5, color: "#8a94a3", marginTop: 6 }}>PDF / JPG / PNG / WEBP · up to 4 MB.</div>

      <div style={{ marginTop: 14 }}>
        {docs === null ? (
          <div style={{ fontSize: 12.5, color: "#8a94a3" }}>Loading…</div>
        ) : docs.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#8a94a3" }}>No documents yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              {docs.map((d) => (
                <tr key={d.docId} style={{ borderTop: "1px solid #eef2f7" }}>
                  <td style={{ padding: "8px 6px", width: 150, color: "#1f3a5f", fontWeight: 600 }}>{kindLabel(d.kind)}</td>
                  <td style={{ padding: "8px 6px" }}>
                    <a href={`/api/employees/${seq}/docs/${d.docId}`} target="_blank" rel="noreferrer" style={{ color: "#2f4fb0" }}>
                      {d.fileName}
                    </a>
                    {d.label ? <span style={{ color: "#8a94a3" }}> — {d.label}</span> : null}
                  </td>
                  <td style={{ padding: "8px 6px", color: "#8a94a3", textAlign: "right", whiteSpace: "nowrap" }}>{humanSize(d.sizeBytes)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>
                    <button onClick={() => onDelete(d.docId, d.fileName)} style={{ background: "none", border: "none", color: "#c0344c", fontSize: 12, cursor: "pointer" }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
