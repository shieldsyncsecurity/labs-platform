/**
 * "The Isolated Assessment" - signature hero visual.
 *
 * A floating ISOMETRIC 3D scene of ONE sealed, isolated AWS account being
 * auto-graded. Pure CSS 3D (perspective + preserve-3d) + inline SVG, animated
 * only with CSS @keyframes (see globals.css, the `.hv-*` classes). No JS, no
 * libraries. Decorative -> aria-hidden. Freezes still under
 * prefers-reduced-motion. Stacks + simplifies below the copy on small screens.
 *
 * All keyframes / class definitions live in globals.css so this file stays a
 * pure structural component.
 */
export function HeroVisual() {
  return (
    <div className="hv" aria-hidden="true">
      {/* Ambient soft glows + floating dots (2D, behind the 3D scene) */}
      <div className="hv-glow hv-glow-brand" />
      <div className="hv-glow hv-glow-blue" />
      <span className="hv-dot hv-dot-1" />
      <span className="hv-dot hv-dot-2" />
      <span className="hv-dot hv-dot-3" />
      <span className="hv-dot hv-dot-4" />

      {/* Perspective viewport */}
      <div className="hv-stage">
        <div className="hv-scene">
          {/* Grounding perspective grid floor */}
          <div className="hv-floor" />

          {/* THE ISOLATION STACK - stacked translucent glass panels */}
          <div className="hv-stack">
            <StackPanel label="NETWORK" depth={0} />
            <StackPanel label="IAM" depth={1} />
            <StackPanel label="DATA (S3)" depth={2} />

            {/* Top live-assessment panel. NOTE: intentionally has NO hv-edge-label
                -- unlike the empty stack panels below, this one carries the
                LIVE ASSESSMENT card content, and an edge label at top:10px
                collides with the card header under the isometric skew. */}
            <div className="hv-panel hv-panel-top" style={{ transform: "translateZ(144px)" }}>
              <div className="hv-assess">
                <div className="hv-assess-head">
                  <span className="hv-assess-title">LIVE ASSESSMENT</span>
                  <Countdown />
                </div>

                <ObjectiveRow text="Scope least-privilege IAM role" order={1} />
                <ObjectiveRow text="Block public S3 access" order={2} />
                <ObjectiveRow text="Enable CloudTrail detection" order={3} />
                <ObjectiveRow text="Contain the exposed key" order={4} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DATA FLOW - drift in / out (2D overlay, positioned over the scene) */}
      <div className="hv-token">
        <LinkIcon />
        <span className="hv-token-text">magic-link</span>
      </div>

      <div className="hv-report">
        <div className="hv-report-head">
          <span className="hv-report-title">SCORED REPORT</span>
          <span className="hv-report-score">92</span>
        </div>
        <span className="hv-report-bar" style={{ width: "92%" }} />
        <span className="hv-report-bar" style={{ width: "74%" }} />
        <span className="hv-report-bar" style={{ width: "88%" }} />
      </div>
    </div>
  );
}

/** One translucent glass panel in the isolation stack, with a mono edge label. */
function StackPanel({ label, depth }: { label: string; depth: number }) {
  return (
    <div className="hv-panel" style={{ transform: `translateZ(${depth * 48}px)` }}>
      <span className="hv-edge-label">{label}</span>
    </div>
  );
}

/** An objective row: an empty square that ticks to a green check, staggered by order. */
function ObjectiveRow({ text, order }: { text: string; order: number }) {
  return (
    <div className="hv-obj" style={{ ["--hv-obj-order" as string]: String(order) }}>
      <span className="hv-check">
        <svg viewBox="0 0 16 16" fill="none">
          <path
            className="hv-check-path"
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="hv-obj-text">{text}</span>
    </div>
  );
}

/** Small circular SVG countdown ring depleting via stroke-dashoffset + mono time label. */
function Countdown() {
  // r = 13 -> circumference ~= 81.68
  return (
    <span className="hv-count">
      <svg viewBox="0 0 32 32">
        <circle className="hv-count-track" cx="16" cy="16" r="13" />
        <circle className="hv-count-ring" cx="16" cy="16" r="13" />
      </svg>
      <span className="hv-count-label">14:00</span>
    </span>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="hv-token-icon">
      <path
        d="M6.5 9.5l3-3M6 6H4.8a2.2 2.2 0 100 4.4H6m4-4.8h1.2a2.2 2.2 0 010 4.4H10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
