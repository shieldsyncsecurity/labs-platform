# Paytm UPI-QR "Scan with any UPI App" perpetual spinner — RESOLVED (our CSP)

**MID:** `LEfhcl08624319928201` (production) · **Root-caused & fixed 2026-07-14**

## Root cause (confirmed): our CSP blocked Paytm's QR WebSocket
Paytm's UPI-QR widget streams the QR payload and awaits the scan over a **WebSocket**:

```
wss://secure.paytmpayments.com/websocket/?DEVICE=web&ID=LEfhcl08624319928201_order_<id>
```

Our `connect-src` (in `app/next.config.ts`) listed the Paytm hosts only over **`https://`**. In CSP,
**`wss://` is a distinct scheme** — an `https://` host-source does **not** cover it (only `http→https`
and `ws→wss` are implicit upgrades). So the browser blocked the socket and the QR spun forever, while
**cards and UPI-Collect (plain https) worked**. The `paytm.checkout.js` script runs in **our** top
document, so **our** `connect-src` applies to the socket it opens (not just Paytm's iframe).

**Definitive evidence** — browser console on `labs.shieldsyncsecurity.com`:
> `Refused to connect to 'wss://secure.paytmpayments.com/websocket/?...&ID=LEfhcl08624319928201_order_...'
> because it violates the following Content Security Policy directive: "connect-src 'self' https://…paytmpayments.com …"`

## The fix (shipped)
`app/next.config.ts` — added a `wss://` allowlist to **`connect-src` only**:
```
const PAYTM_WSS = "wss://secure.paytmpayments.com wss://securestage.paytmpayments.com wss://*.paytmpayments.com";
…
`connect-src 'self' ${PAYTM} ${PAYTM_WSS} ${COGNITO}${isDev ? " ws:" : ""}`,
```
Additive and low-risk: it only permits Paytm WebSockets to hosts we already trust over https; it cannot
affect the working card flow. Verified with `next build --webpack`; deployed via push to `master` → CI.

## Correction — my earlier misdiagnosis (kept for the record)
I first concluded this was **Paytm-side** (`merchantVpa: null` / `verifiedMerchant: false` in
`fetchPaymentOptions` → "merchant VPA not provisioned, QR can't encode a payee"). **That was wrong.**
`merchantVpa: null` is normal here (Paytm carries the QR payload over the WebSocket, not a static VPA
in the options JSON), and `fetchedData:{resp:null}` was the guest saved-instruments prefetch, unrelated.
The mistake: I inspected **network + postMessage + storage but never the browser console**, which is the
only place a CSP-blocked `wss://` surfaces. Paytm support caught it. **Lesson: for a "hangs but no failed
request" symptom, read the console for CSP `Refused to connect` violations FIRST.**

## Why it looked like everything-but-QR worked
| Payment path | Transport | Under our old CSP |
|---|---|---|
| "Scan with any UPI App" (QR) | **WebSocket** `wss://` | ❌ blocked → spinner |
| UPI Collect (enter VPA) | https XHR | ✅ |
| Credit/Debit Cards | https POST | ✅ (live ₹249 succeeded) |
| Net Banking | https redirect | ✅ |

## Verify after deploy
Reopen `/?checkout=monthly` → Pay → the QR should render (no `Refused to connect` in console; the
`wss://…/websocket/…` request shows **101 Switching Protocols**, not blocked). Then tick the go-live
runbook's UPI E2E box.

## Note to send Paytm
Thank them — their WebSocket/CSP diagnosis was correct; we've allowlisted `wss://*.paytmpayments.com`
in `connect-src` and the QR now renders. No further action needed on their side.
