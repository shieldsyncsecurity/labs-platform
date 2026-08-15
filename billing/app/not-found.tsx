import { COMPANY } from "@/lib/company";

// Shown for an invalid/expired token or a missing invoice. Same dark brand
// language as the landing page so a bad link never drops the client onto a
// jarring white template.
export default function NotFound() {
  return (
    <main className="nf-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="nf-glow" aria-hidden />

      <div className="nf-shell">
        <div className="nf-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cipher-s-mark.png" alt="" width={48} height={48} className="nf-mark" />
          <div>
            <div className="nf-wordmark">{COMPANY.shortName}</div>
            <div className="nf-tag">Billing portal</div>
          </div>
        </div>

        <section className="nf-card">
          <div className="nf-code">404</div>
          <h1 className="nf-h1">Invoice not found</h1>
          <p className="nf-lede">
            This invoice link is invalid or has expired. Please check the email
            you received from {COMPANY.shortName}, or reach out and we&apos;ll
            resend it.
          </p>
          <a className="nf-btn" href={`mailto:${COMPANY.email}`}>
            Contact {COMPANY.email}
          </a>
        </section>

        <footer className="nf-foot">{COMPANY.legalName} · CIN {COMPANY.cin}</footer>
      </div>
    </main>
  );
}

const CSS = `
  .nf-root {
    position: relative; min-height: 100vh; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    padding: 48px 24px; box-sizing: border-box;
    background: radial-gradient(120% 120% at 50% -10%, #16203a 0%, #0b1120 55%, #080d18 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #e8ecf6; -webkit-font-smoothing: antialiased;
  }
  .nf-glow {
    position: absolute; top: -220px; left: 50%; transform: translateX(-50%);
    width: 620px; height: 620px; pointer-events: none;
    background: radial-gradient(circle, rgba(99,102,241,.24) 0%, rgba(99,102,241,0) 68%);
  }
  .nf-shell { position: relative; width: 100%; max-width: 440px; text-align: center; }
  .nf-brand { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 26px; }
  .nf-mark {
    border-radius: 12px; display: block;
    box-shadow: 0 8px 24px rgba(79,70,229,.32), 0 0 0 1px rgba(255,255,255,.04);
  }
  .nf-wordmark { font-size: 18px; font-weight: 800; color: #f4f6fc; text-align: left; }
  .nf-tag { font-size: 11px; color: #8b96b4; margin-top: 1px; text-align: left; }

  .nf-card {
    background: linear-gradient(180deg, rgba(30,40,66,.72) 0%, rgba(18,26,46,.72) 100%);
    border: 1px solid rgba(120,134,180,.18); border-radius: 18px; padding: 34px 34px 30px;
    box-shadow: 0 24px 60px rgba(4,8,20,.55), inset 0 1px 0 rgba(255,255,255,.05);
    backdrop-filter: blur(8px);
  }
  .nf-code {
    font-size: 46px; font-weight: 900; letter-spacing: -.02em; line-height: 1;
    background: linear-gradient(180deg, #4b5a86 0%, #2b3557 100%);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .nf-h1 { margin: 12px 0 0; font-size: 20px; font-weight: 800; color: #f7f9ff; }
  .nf-lede { margin: 10px 0 0; font-size: 13.5px; line-height: 1.6; color: #b9c2dc; }
  .nf-btn {
    display: inline-block; margin-top: 22px; padding: 11px 22px; border-radius: 10px;
    font-size: 13.5px; font-weight: 700; text-decoration: none; color: #fff;
    background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
    box-shadow: 0 8px 22px rgba(79,70,229,.4); transition: transform .12s ease, box-shadow .12s ease;
  }
  .nf-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(79,70,229,.5); }
  .nf-foot { margin-top: 24px; font-size: 11px; color: #5c678a; }
`;
