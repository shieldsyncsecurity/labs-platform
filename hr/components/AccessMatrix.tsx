"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AREA_META, AREAS, assistantPreset, noAccess, type Access, type Area, type Level } from "@/lib/access";

type Person = { email: string; isAdmin: boolean; access: Access | null; configured: boolean };

const LEVEL_UI: Record<Level, { label: string; bg: string; fg: string; border: string }> = {
  none: { label: "No access", bg: "#fff", fg: "#8a94a3", border: "#e2e8f2" },
  read: { label: "Can view", bg: "#eef6ff", fg: "#1f3a5f", border: "#c3d8f0" },
  write: { label: "Can change", bg: "#e7f6ee", fg: "#146c3c", border: "#b7e2c9" },
};

/** One person's permission card. Each area is a 3-way segmented control rather
 * than a dropdown, so the whole grant is readable at a glance without opening
 * seven menus — the question "what can she see?" should be answered by looking,
 * not by clicking. */
function PersonCard({ person }: { person: Person }) {
  const router = useRouter();
  const [access, setAccess] = useState<Access>(person.access ?? noAccess());
  const [savedJson, setSavedJson] = useState(JSON.stringify(person.access ?? noAccess()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const dirty = JSON.stringify(access) !== savedJson;

  const setArea = (area: Area, level: Level) => setAccess((a) => ({ ...a, areas: { ...a.areas, [area]: level } }));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/access", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: person.email, access }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Could not save." });
      } else {
        setSavedJson(JSON.stringify(access));
        setMsg({ kind: "ok", text: "Saved — this applies the next time they load a page." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server." });
    }
    setBusy(false);
  }

  const grantedCount = AREAS.filter((a) => access.areas[a] !== "none").length;

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f2", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#1f3a5f" }}>{person.email}</div>
        {!person.configured ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8a5a00", background: "#fdf4e3", border: "1px solid #f0d9a8", borderRadius: 999, padding: "2px 9px" }}>
            Never set up — currently has nothing
          </span>
        ) : (
          <span style={{ fontSize: 11.5, color: "#5b6676" }}>
            {grantedCount} of {AREAS.length} areas
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setAccess(assistantPreset())}
          disabled={busy}
          style={{ background: "none", border: "1px dashed #c3cee0", color: "#41506a", fontSize: 12, fontWeight: 600, borderRadius: 7, padding: "6px 11px", cursor: "pointer" }}
        >
          Use assistant preset
        </button>
        <button
          type="button"
          onClick={() => setAccess(noAccess())}
          disabled={busy}
          style={{ background: "none", border: "none", color: "#c0344c", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          Revoke everything
        </button>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        {AREAS.map((area) => {
          const meta = AREA_META[area];
          const level = access.areas[area];
          return (
            <div
              key={area}
              style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.4fr) auto", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid #f2f5fa" }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1b2331" }}>{meta.label}</div>
                <div style={{ fontSize: 11.5, color: "#8a94a3", lineHeight: 1.45 }}>
                  {level === "none" ? meta.blurb : level === "read" ? meta.readMeans : meta.writeMeans}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {(["none", "read", "write"] as Level[]).map((lv) => {
                  const on = level === lv;
                  const ui = LEVEL_UI[lv];
                  return (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setArea(area, lv)}
                      disabled={busy}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: "6px 11px",
                        borderRadius: 7,
                        whiteSpace: "nowrap",
                        cursor: busy ? "default" : "pointer",
                        background: on ? ui.bg : "#fafbfd",
                        color: on ? ui.fg : "#a9b2c1",
                        border: `1px solid ${on ? ui.border : "#eef2f7"}`,
                      }}
                    >
                      {ui.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cross-cutting visibility. Kept apart from the areas because these hide
          FIELDS inside pages the person can otherwise legitimately open. */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f2f5fa" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#8a94a3", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
          What they see inside a record
        </div>
        {(
          [
            { key: "seeSalary" as const, label: "Salary figures", hint: "Gross, annual CTC and the basic / HRA / conveyance / special split." },
            { key: "seeBankDetails" as const, label: "Bank details & PAN", hint: "Account number, IFSC and PAN on employee records." },
          ]
        ).map((row) => (
          <label key={row.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={access[row.key]}
              disabled={busy}
              onChange={(e) => setAccess((a) => ({ ...a, [row.key]: e.target.checked }))}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1b2331" }}>{row.label}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "#8a94a3", lineHeight: 1.45 }}>{row.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {msg ? (
        <div
          style={{
            marginTop: 12,
            fontSize: 12.5,
            padding: "8px 11px",
            borderRadius: 8,
            background: msg.kind === "ok" ? "#e7f6ee" : "#fdecef",
            border: `1px solid ${msg.kind === "ok" ? "#b7e2c9" : "#f6c6ce"}`,
            color: msg.kind === "ok" ? "#146c3c" : "#9a2233",
          }}
        >
          {msg.text}
        </div>
      ) : null}

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          style={{
            background: dirty ? "#1f3a5f" : "#eef2f8",
            color: dirty ? "#fff" : "#5b6676",
            border: dirty ? "none" : "1px solid #d4dbe8",
            borderRadius: 8,
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            cursor: busy || !dirty ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Saving…" : dirty ? "Save changes" : "Saved ✓"}
        </button>
        {dirty ? <span style={{ fontSize: 11.5, color: "#8a5a00" }}>Unsaved changes</span> : null}
      </div>
    </div>
  );
}

export function AccessMatrix({ people }: { people: Person[] }) {
  const admins = people.filter((p) => p.isAdmin);
  const staff = people.filter((p) => !p.isAdmin);

  return (
    <div>
      {staff.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #d4dbe8", borderRadius: 12, padding: 22, fontSize: 13, color: "#5b6676" }}>
          Nobody but the administrator can sign in yet. Add an address to <code>HR_ALLOWLIST</code> first, then set what they can do here.
        </div>
      ) : (
        staff.map((p) => <PersonCard key={p.email} person={p} />)
      )}

      {admins.length ? (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f2", borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#8a94a3", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Administrator
          </div>
          {admins.map((a) => (
            <div key={a.email} style={{ fontSize: 13.5, fontWeight: 700, color: "#1f3a5f", marginTop: 6 }}>
              {a.email}
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "#5b6676", marginTop: 6, lineHeight: 1.5 }}>
            Always has everything, and it can&rsquo;t be edited here on purpose — administrator status comes from the deployment
            settings, not from this page. That&rsquo;s what makes it impossible to lock yourself out of your own portal.
          </div>
        </div>
      ) : null}
    </div>
  );
}
