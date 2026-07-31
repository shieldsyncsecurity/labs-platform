import { COMPANY } from "@/lib/company";

export const dynamic = "force-dynamic";

// Client-facing billing home. Clients almost always arrive on /inv/[token]
// straight from an emailed link; this root page is the branded fallback for
// anyone who types the bare domain. Dark, brand-accurate (slate-900 + indigo),
// anchored on the real cipher-S mark — not a naked 404, not a template card.
export default function LandingPage() {
  return (
    <main className="bill-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="bill-glow" aria-hidden />

      <div className="bill-shell">
        {/* Brand lockup */}
        <div className="bill-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cipher-s-mark.png" alt="" width={56} height={56} className="bill-mark" />
          <div>
            <div className="bill-wordmark">{COMPANY.shortName}</div>
            <div className="bill-tag">{COMPANY.tagline}</div>
          </div>
        </div>

        {/* Card */}
        <section className="bill-card">
          <div className="bill-eyebrow">
            <span className="bill-dot" />
            Secure billing portal
          </div>

          <h1 className="bill-h1">View your invoice</h1>
          <p className="bill-lede">
            If {COMPANY.shortName} has issued you an invoice, open the secure link
            from your email to view and download it. Links are private to you and
            don&apos;t require an account.
          </p>

          <div className="bill-contact">
            <div className="bill-contact-label">Questions about your invoice?</div>
            <a className="bill-contact-row" href={`mailto:${COMPANY.email}`}>
              <span className="bill-ico">✉</span>
              <span>{COMPANY.email}</span>
            </a>
            {COMPANY.phone && (
              <a className="bill-contact-row" href={`tel:${COMPANY.phone.replace(/\s/g, "")}`}>
                <span className="bill-ico">☎</span>
                <span>{COMPANY.phone}</span>
              </a>
            )}
          </div>

          <div className="bill-trust">
            <span className="bill-lock">🔒</span>
            Invoice links are token-authenticated and unique to each recipient.
          </div>
        </section>

        <footer className="bill-foot">
          {COMPANY.legalName} · CIN {COMPANY.cin} · {COMPANY.locationLine}
        </footer>
      </div>
    </main>
  );
}

const CSS = `
  .bill-root {
    position: relative; min-height: 100vh; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    padding: 48px 24px; box-sizing: border-box;
    background:
      radial-gradient(120% 120% at 50% -10%, #16203a 0%, #0b1120 55%, #080d18 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #e8ecf6; -webkit-font-smoothing: antialiased;
  }
  .bill-glow {
    position: absolute; top: -220px; left: 50%; transform: translateX(-50%);
    width: 640px; height: 640px; pointer-events: none;
    background: radial-gradient(circle, rgba(99,102,241,.28) 0%, rgba(99,102,241,0) 68%);
    filter: blur(8px);
  }
  .bill-shell { position: relative; width: 100%; max-width: 460px; text-align: center; }

  .bill-brand {
    display: inline-flex; align-items: center; gap: 14px; margin-bottom: 28px; text-align: left;
  }
  .bill-mark {
    border-radius: 14px; display: block;
    box-shadow: 0 8px 28px rgba(79,70,229,.35), 0 0 0 1px rgba(255,255,255,.04);
  }
  .bill-wordmark { font-size: 21px; font-weight: 800; letter-spacing: -.01em; color: #f4f6fc; }
  .bill-tag { font-size: 11.5px; color: #8b96b4; margin-top: 2px; letter-spacing: .01em; }

  .bill-card {
    position: relative; text-align: left;
    background: linear-gradient(180deg, rgba(30,40,66,.72) 0%, rgba(18,26,46,.72) 100%);
    border: 1px solid rgba(120,134,180,.18);
    border-radius: 18px; padding: 30px 32px 26px;
    box-shadow: 0 24px 60px rgba(4,8,20,.55), inset 0 1px 0 rgba(255,255,255,.05);
    backdrop-filter: blur(8px);
  }
  .bill-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em;
    color: #a9b4d6; margin-bottom: 16px;
  }
  .bill-dot {
    width: 7px; height: 7px; border-radius: 50%; background: #34d399;
    box-shadow: 0 0 0 3px rgba(52,211,153,.18);
  }
  .bill-h1 { margin: 0; font-size: 25px; font-weight: 800; letter-spacing: -.02em; color: #f7f9ff; }
  .bill-lede { margin: 10px 0 0; font-size: 14px; line-height: 1.65; color: #b9c2dc; }

  .bill-contact {
    margin-top: 24px; padding: 16px 18px; border-radius: 12px;
    background: rgba(10,15,28,.5); border: 1px solid rgba(120,134,180,.14);
  }
  .bill-contact-label {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em;
    color: #7e89ab; margin-bottom: 11px;
  }
  .bill-contact-row {
    display: flex; align-items: center; gap: 11px; text-decoration: none;
    font-size: 14px; font-weight: 600; color: #dfe5f5; padding: 5px 0;
    transition: color .15s ease;
  }
  .bill-contact-row:hover { color: #a5b4fc; }
  .bill-ico {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 7px; font-size: 13px;
    background: rgba(99,102,241,.16); color: #a5b4fc; flex: 0 0 auto;
  }

  .bill-trust {
    margin-top: 18px; display: flex; align-items: flex-start; gap: 8px;
    font-size: 12px; line-height: 1.5; color: #8b96b4;
  }
  .bill-lock { font-size: 12px; opacity: .9; }

  .bill-foot {
    margin-top: 26px; font-size: 11px; line-height: 1.6; color: #5c678a;
    letter-spacing: .01em;
  }

  @media (max-width: 480px) {
    .bill-card { padding: 26px 22px 22px; }
    .bill-h1 { font-size: 22px; }
  }
`;
