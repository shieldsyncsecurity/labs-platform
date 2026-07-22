import { cognitoEnabled } from "@/lib/server/cognito";
import { hrAllowlist } from "@/lib/server/hr-token";

export const metadata = {
  title: "Sign in — ShieldSync HR",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  not_allowed: "That account isn't authorised for the HR portal.",
  state: "Your sign-in session expired. Please try again.",
  token: "Sign-in failed. Please try again.",
  verify: "We couldn't verify your identity. Please try again.",
  sso: "Sign-in was cancelled.",
  missing_code: "Sign-in was interrupted. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; dev?: string }>;
}) {
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? "Sign-in failed.") : null;
  const devEnabled = process.env.HR_DEV_LOGIN === "1" && process.env.NODE_ENV !== "production";
  const showDev = devEnabled && (!cognitoEnabled() || sp.dev === "1");
  const emails = [...hrAllowlist()];

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#eef2f8",
        padding: 24,
        fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          border: "1px solid #d9dfea",
          borderRadius: 14,
          padding: "34px 30px",
          boxShadow: "0 12px 34px rgba(31,58,95,.10)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/brand/cipher-s-mark.png" alt="ShieldSync" width={40} height={40} style={{ borderRadius: 9 }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#1f3a5f" }}>ShieldSync HR</div>
            <div style={{ fontSize: 11.5, color: "#5b6676" }}>Internal document portal</div>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: "#5b6676", marginTop: 18, lineHeight: 1.5 }}>
          Access is restricted to authorised HR staff. Sign in with your ShieldSync account.
        </p>

        {error ? (
          <div
            style={{
              marginTop: 14,
              background: "#fdecef",
              border: "1px solid #f6c6ce",
              color: "#9a2233",
              fontSize: 12,
              borderRadius: 8,
              padding: "9px 12px",
            }}
          >
            {error}
          </div>
        ) : null}

        <a
          href="/api/auth/login"
          style={{
            display: "block",
            textAlign: "center",
            marginTop: 18,
            background: "#1f3a5f",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
            borderRadius: 9,
            padding: "11px 14px",
          }}
        >
          Sign in with ShieldSync
        </a>

        {showDev ? (
          <form
            action="/api/auth/dev-login"
            method="post"
            style={{ marginTop: 22, borderTop: "1px dashed #d9dfea", paddingTop: 16 }}
          >
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 700 }}>
              Local dev sign-in
            </div>
            <select
              name="email"
              defaultValue={emails[0] ?? ""}
              style={{ width: "100%", marginTop: 8, padding: "9px 10px", fontSize: 13, border: "1px solid #d9dfea", borderRadius: 8 }}
            >
              {emails.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                width: "100%",
                marginTop: 10,
                background: "#2f4fb0",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "9px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Continue (dev)
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
