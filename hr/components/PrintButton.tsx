"use client";

// Client-side "Save as PDF" trigger. Branded letterheads print via the browser
// (window.print()) using the print CSS in letterhead-css.ts, which yields a
// clean A4 PDF with the app chrome hidden (.ss-noprint).
export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        background: "#1f3a5f",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
