// Shared, server-safe invoice math + text renderer for the GST tax invoice
// (sprint W3B-2). Imported by BOTH the print-clean HTML view
// (orders/[orderId]/invoice/page.tsx) and the PDF route
// (api/admin/invoice/pdf/route.ts) so the two can never drift.
//
// Tax model is deliberately simple (the sprint says "NO new tax logic beyond a
// simple intra/inter-state split; founder still owns filing"): the stored
// amountMinor is treated as tax-INCLUSIVE, we back-compute an 18% GST split for
// DISPLAY only, and every figure reconciles exactly to amountMinor. Intra-state
// (buyer state == seller state) shows CGST + SGST at half each; inter-state
// shows a single IGST line.
//
// All amounts are carried in MINOR units (paise for INR) as integers so the
// split reconciles to the last unit; only the display formatter divides by 100.

export type InvoiceOrder = {
  orderId?: string;
  orgId?: string;
  invoiceNo?: string;
  gstin?: string;
  amountMinor?: number;
  currency?: string;
  credits?: number;
  note?: string;
  status?: string;
  createdAt?: string;
  paidAt?: string;
};

export type InvoiceOrg = {
  orgId?: string;
  name?: string;
  gstin?: string;
  billingAddress?: string;
  // Optional overrides -- not populated by createOrg today, but honored if a
  // future org row carries an explicit place of supply.
  placeOfSupply?: string;
  state?: string;
};

export type SellerMeta = {
  legalName: string;
  gstin: string;
  address: string;
  state: string;
};

export type BuyerMeta = {
  name: string;
  gstin: string;
  address: string;
  placeOfSupply: string;
};

export type InvoiceComputation = {
  currency: string;
  credits: number;
  unitMinor: number; // per-credit rate, tax-inclusive (may be fractional)
  totalMinor: number; // == amountMinor, the tax-inclusive grand total
  taxableMinor: number; // total ex-GST (back-computed)
  taxMinor: number; // total GST included in the total
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  intraState: boolean;
  ratePct: number; // 18
};

// GST @18% assumed on the stored inclusive amount. Kept as a named constant so
// the label ("GST @18% (incl.)") and the math stay in lockstep.
const GST_RATE = 0.18;
const GST_RATE_PCT = 18;

// First two digits of a GSTIN are the state code. This is identification only
// (mapping a code to a name), not tax computation, so it stays within the
// "no new tax logic" guardrail while letting the intra/inter-state split
// actually work for orgs that only carry a GSTIN.
const GSTIN_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

/** Map a GSTIN's leading 2-digit state code to a state name, or "" if unknown. */
export function gstinStateName(gstin?: string): string {
  const code = (gstin ?? "").trim().slice(0, 2);
  return GSTIN_STATE_CODES[code] ?? "";
}

function normalizeState(s?: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve the buyer's place of supply, preferring an explicit org field, then
 * the GSTIN-derived state (order GSTIN first, then org GSTIN). Returns "" when
 * nothing is known.
 */
export function resolvePlaceOfSupply(order: InvoiceOrder, org: InvoiceOrg): string {
  const explicit = (org.placeOfSupply || org.state || "").trim();
  if (explicit) return explicit;
  return gstinStateName(order.gstin) || gstinStateName(org.gstin);
}

/**
 * Back-compute the GST split for a tax-inclusive amount. Everything reconciles
 * to totalMinor: taxableMinor + taxMinor == totalMinor, and for intra-state
 * cgstMinor + sgstMinor == taxMinor exactly (SGST absorbs the odd unit).
 */
export function computeInvoice(
  order: InvoiceOrder,
  org: InvoiceOrg,
  sellerState: string,
): InvoiceComputation {
  const totalMinor = Math.max(0, Math.round(Number(order.amountMinor) || 0));
  const credits = Math.max(0, Math.round(Number(order.credits) || 0));
  const currency = (order.currency || "INR").trim().toUpperCase() || "INR";

  const unitMinor = credits > 0 ? totalMinor / credits : totalMinor;

  // Inclusive -> exclusive: taxable = total / (1 + rate); tax = the remainder.
  const taxableMinor = Math.round(totalMinor / (1 + GST_RATE));
  const taxMinor = totalMinor - taxableMinor;

  const placeOfSupply = resolvePlaceOfSupply(order, org);
  const intraState =
    normalizeState(placeOfSupply) !== "" &&
    normalizeState(placeOfSupply) === normalizeState(sellerState);

  let cgstMinor = 0;
  let sgstMinor = 0;
  let igstMinor = 0;
  if (intraState) {
    cgstMinor = Math.floor(taxMinor / 2);
    sgstMinor = taxMinor - cgstMinor;
  } else {
    igstMinor = taxMinor;
  }

  return {
    currency,
    credits,
    unitMinor,
    totalMinor,
    taxableMinor,
    taxMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    intraState,
    ratePct: GST_RATE_PCT,
  };
}

/**
 * Format a minor-unit amount (possibly fractional for a per-credit rate) as a
 * grouped major-unit string prefixed with the ASCII currency code, e.g.
 * "INR 1,234.56". ASCII-only on purpose (never the rupee sign) so the same
 * string is safe for the PDF writer's WinAnsi text stream.
 */
export function formatMoneyMinor(minor: number, currency: string): string {
  const major = (Number(minor) || 0) / 100;
  const grouped = major.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${grouped}`;
}

// Seller entity block. GSTIN + address + state come from env so the founder can
// set the real values without a code change; every field has a safe placeholder
// so the invoice still renders (clearly marked "pending") before they are set.
const SELLER_LEGAL_NAME = "ShieldSync Security Private Limited";
const SELLER_ADDRESS_PLACEHOLDER = "Registered office address pending";

/** Read the seller entity block from env (server-only). */
export function sellerMetaFromEnv(): SellerMeta {
  const gstin = (process.env.SHIELDSYNC_GSTIN ?? "").trim();
  const address = (process.env.SHIELDSYNC_ADDRESS ?? "").trim();
  const state = (process.env.SHIELDSYNC_STATE ?? "").trim();
  return {
    legalName: SELLER_LEGAL_NAME,
    gstin: gstin || "<GSTIN pending>",
    address: address || SELLER_ADDRESS_PLACEHOLDER,
    state: state || "Uttar Pradesh",
  };
}

/** Build the bill-to block from the org + order (order GSTIN wins over org). */
export function buyerMeta(order: InvoiceOrder, org: InvoiceOrg): BuyerMeta {
  return {
    name: (org.name ?? "").trim(),
    gstin: ((order.gstin || org.gstin) ?? "").trim(),
    address: (org.billingAddress ?? "").trim(),
    placeOfSupply: resolvePlaceOfSupply(order, org),
  };
}

/** Invoice number: the founder's own invoiceNo, else a stable id-prefix fallback. */
export function invoiceNumber(order: InvoiceOrder): string {
  const explicit = (order.invoiceNo ?? "").trim();
  if (explicit) return explicit;
  const idp = (order.orderId ?? "").slice(0, 8).toUpperCase();
  return idp ? `SS-${idp}` : "SS-DRAFT";
}

function fmtDate(value?: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
}

/**
 * Render the invoice as a plain-text document for the text-pdf writer. "# "
 * prefixes become bold section heads; everything else is body. All output is
 * ASCII (formatMoneyMinor and the constants above never emit non-ASCII), so the
 * PDF sanitizer is a no-op safety net rather than a lossy pass.
 */
export function renderInvoiceText(
  order: InvoiceOrder,
  seller: SellerMeta,
  buyer: BuyerMeta,
  comp: InvoiceComputation,
): string {
  const lines: string[] = [];
  const money = (m: number) => formatMoneyMinor(m, comp.currency);

  lines.push(`Invoice no: ${invoiceNumber(order)}`);
  lines.push(`Invoice date: ${fmtDate(order.createdAt)}`);
  if (order.paidAt) lines.push(`Payment date: ${fmtDate(order.paidAt)}`);
  lines.push(`Status: ${order.status === "paid" ? "PAID" : "Awaiting payment"}`);
  lines.push("");

  lines.push("# Seller");
  lines.push(seller.legalName);
  if (seller.address) lines.push(seller.address);
  lines.push(`GSTIN: ${seller.gstin}`);
  lines.push(`State of supply: ${seller.state}`);
  lines.push("");

  lines.push("# Bill to");
  lines.push(buyer.name || "-");
  if (buyer.address) lines.push(buyer.address);
  lines.push(`GSTIN: ${buyer.gstin || "Unregistered / not provided"}`);
  lines.push(`Place of supply: ${buyer.placeOfSupply || "Not determined"}`);
  lines.push("");

  lines.push("# Line item");
  lines.push("Description: Assessment credits");
  lines.push(`Quantity: ${comp.credits} credits`);
  lines.push(`Rate (incl. GST): ${money(comp.unitMinor)} per credit`);
  lines.push(`Amount (incl. GST): ${money(comp.totalMinor)}`);
  lines.push("");

  lines.push("# Tax summary (GST @18% incl.)");
  lines.push(`Taxable value: ${money(comp.taxableMinor)}`);
  if (comp.intraState) {
    lines.push(`CGST @9% (incl.): ${money(comp.cgstMinor)}`);
    lines.push(`SGST @9% (incl.): ${money(comp.sgstMinor)}`);
  } else {
    lines.push(`IGST @18% (incl.): ${money(comp.igstMinor)}`);
  }
  lines.push(`Total GST (incl.): ${money(comp.taxMinor)}`);
  lines.push(`Grand total (incl. GST): ${money(comp.totalMinor)}`);
  lines.push("");

  if (order.note) {
    lines.push("# Note");
    lines.push(order.note);
    lines.push("");
  }

  lines.push("# Declaration");
  lines.push(
    "This is a system-generated tax invoice. Figures are computed on a tax-inclusive basis for display; verify all values before filing. ShieldSync Security Private Limited retains responsibility for statutory filing.",
  );

  return lines.join("\n");
}
