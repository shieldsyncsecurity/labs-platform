// Paytm Payment Gateway adapter (server-only).
//
// Implements Paytm's checksum (the exact PaytmChecksum scheme: SHA-256 over
// "<params>|<4-char salt>", appended salt, then AES-128-CBC with a fixed IV, base64)
// using Web Crypto so it runs in BOTH `next dev` (Node) and the Cloudflare Worker.
// Plus the two server-to-server calls we need: Initiate Transaction (get a txnToken
// for checkout) and Order Status (authoritatively confirm a payment).
//
// Credentials come ONLY from env (PAYTM_MID / PAYTM_MERCHANT_KEY / ...). Never logged.
// This module is server-only — never import it into a client component.

const PAYTM_IV = "@@@@&&&&####$$$$"; // Paytm's fixed 16-byte AES-CBC IV

export type PaytmConfig = {
  mid: string;
  key: string;
  website: string;
  industryType: string;
  channelId: string;
  baseUrl: string;
};

export function paytmConfig(): PaytmConfig {
  const env = (process.env.PAYTM_ENV ?? "staging").trim().toLowerCase();
  return {
    mid: process.env.PAYTM_MID ?? "",
    key: process.env.PAYTM_MERCHANT_KEY ?? "",
    website: process.env.PAYTM_WEBSITE ?? "WEBSTAGING",
    industryType: process.env.PAYTM_INDUSTRY_TYPE ?? "Retail",
    channelId: process.env.PAYTM_CHANNEL_ID ?? "WEB",
    // Paytm's CURRENT hosts (the legacy securegw[-stage].paytm.in returns a generic 501
    // "System Error" for MIDs provisioned on the new platform — verified the hard way).
    baseUrl: env === "production" ? "https://secure.paytmpayments.com" : "https://securestage.paytmpayments.com",
  };
}

// ── byte helpers ─────────────────────────────────────────────────────────────
const enc = new TextEncoder();
function bytesToB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function bytesToLatin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

// Cast helper — Web Crypto wants BufferSource; TS types TextEncoder/Uint8Array output
// as Uint8Array<ArrayBufferLike>, which it won't auto-accept. The bytes are identical.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bs(enc.encode(input)));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function aesEncrypt(plaintext: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", bs(enc.encode(key)), { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv: bs(enc.encode(PAYTM_IV)) }, k, bs(enc.encode(plaintext)));
  return bytesToB64(new Uint8Array(ct));
}
async function aesDecrypt(b64: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", bs(enc.encode(key)), { name: "AES-CBC" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-CBC", iv: bs(enc.encode(PAYTM_IV)) }, k, bs(b64ToBytes(b64)));
  return bytesToLatin1(new Uint8Array(pt));
}

// 4-char salt = base64 of 3 random bytes (matches Paytm's generateRandomString(4)).
function randomSalt(): string {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return bytesToB64(b); // 3 bytes -> exactly 4 base64 chars, no padding
}

// Paytm's param-map → "|"-joined values, sorted by key; null/"null" → "".
function stringByParams(params: Record<string, string | null | undefined>): string {
  return Object.keys(params)
    .sort()
    .map((k) => {
      const v = params[k];
      return v != null && String(v).toLowerCase() !== "null" ? String(v) : "";
    })
    .join("|");
}

async function calculateHash(params: string, salt: string): Promise<string> {
  return (await sha256Hex(params + "|" + salt)) + salt;
}

/** Generate a Paytm checksum signature for a body string OR a param map. */
export async function generateSignature(input: string | Record<string, string | null | undefined>, key: string): Promise<string> {
  const params = typeof input === "string" ? input : stringByParams(input);
  const salt = randomSalt();
  const hashString = await calculateHash(params, salt);
  return aesEncrypt(hashString, key);
}

/** Verify a Paytm checksum against a body string OR param map (CHECKSUMHASH excluded). */
export async function verifySignature(
  input: string | Record<string, string | null | undefined>,
  key: string,
  checksum: string
): Promise<boolean> {
  try {
    let params: string;
    if (typeof input === "string") {
      params = input;
    } else {
      const { CHECKSUMHASH, ...rest } = input; // never sign the checksum itself
      void CHECKSUMHASH;
      params = stringByParams(rest);
    }
    const paytmHash = await aesDecrypt(checksum, key);
    const salt = paytmHash.slice(-4);
    return paytmHash === (await calculateHash(params, salt));
  } catch {
    return false;
  }
}

// ── server-to-server APIs ────────────────────────────────────────────────────

export type InitiateResult = { ok: boolean; txnToken?: string; orderId: string; error?: string; raw?: unknown };

/**
 * Initiate Transaction: signs the request body with our checksum and asks Paytm for a
 * txnToken (which the browser checkout uses). The amount is taken from OUR order in
 * major units (rupees), never from the client.
 */
export async function initiateTransaction(args: {
  orderId: string;
  amountMinor: number;
  currency: string;
  custId: string;
  callbackUrl: string;
}): Promise<InitiateResult> {
  const cfg = paytmConfig();
  const body = {
    requestType: "Payment",
    mid: cfg.mid,
    websiteName: cfg.website,
    orderId: args.orderId,
    callbackUrl: args.callbackUrl,
    txnAmount: { value: (args.amountMinor / 100).toFixed(2), currency: args.currency },
    userInfo: { custId: args.custId },
  };
  const signature = await generateSignature(JSON.stringify(body), cfg.key);
  const url = `${cfg.baseUrl}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(cfg.mid)}&orderId=${encodeURIComponent(args.orderId)}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, head: { signature } }),
    });
    const data = (await r.json()) as { body?: { txnToken?: string; resultInfo?: { resultStatus?: string; resultMsg?: string } } };
    const txnToken = data?.body?.txnToken;
    if (txnToken) return { ok: true, txnToken, orderId: args.orderId, raw: data };
    return { ok: false, orderId: args.orderId, error: data?.body?.resultInfo?.resultMsg ?? "initiate failed", raw: data };
  } catch (e) {
    return { ok: false, orderId: args.orderId, error: e instanceof Error ? e.message : "network error" };
  }
}

export type StatusResult = { ok: boolean; status?: string; amountMinor?: number; currency?: string; paymentId?: string; raw?: unknown };

/** Order Status: the authoritative server-to-server confirmation of a payment. */
export async function transactionStatus(orderId: string): Promise<StatusResult> {
  const cfg = paytmConfig();
  const body = { mid: cfg.mid, orderId };
  const signature = await generateSignature(JSON.stringify(body), cfg.key);
  try {
    const r = await fetch(`${cfg.baseUrl}/v3/order/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, head: { signature } }),
    });
    const data = (await r.json()) as {
      body?: { resultInfo?: { resultStatus?: string }; txnAmount?: string; currency?: string; txnId?: string };
    };
    const b = data?.body;
    const amt = b?.txnAmount ? Math.round(parseFloat(b.txnAmount) * 100) : undefined;
    return {
      ok: true,
      status: b?.resultInfo?.resultStatus, // TXN_SUCCESS | TXN_FAILURE | PENDING
      amountMinor: amt,
      currency: b?.currency,
      paymentId: b?.txnId,
      raw: data,
    };
  } catch (e) {
    return { ok: false, raw: e instanceof Error ? e.message : "network error" };
  }
}
