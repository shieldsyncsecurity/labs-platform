// Payslip model: salary-structure math, the statutory deduction engine, and
// Indian amount-in-words. Pure + dependency-free (server components, route
// handlers, and the print view all import it), mirroring the enterprise
// invoice-model pattern so the on-screen payslip and any generated PDF can
// never drift.
//
// Layout + fields are taken 1:1 from the company's signed payslips
// (Projects\ShieldSync Documents\Diya Visa\Final\ShieldSync_Salary_Slip_*).
// All money is INR, ASCII "INR " prefix (never the rupee glyph), grouped en-IN.

import { PROFESSIONAL_TAX_LEVIED_IN_STATE } from "./company";

// --- Salary structure --------------------------------------------------------

export type SalaryStructure = {
  basic: number;
  hra: number;
  conveyance: number;
  special: number;
  /** Always equals basic + hra + conveyance + special. */
  gross: number;
};

/**
 * Suggest a monthly structure from a gross figure, using the convention on the
 * company's signed Annexure A (Diya Jain, gross 30,000 -> 15,000 / 6,000 /
 * 1,600 / 7,400): Basic = 50% of gross, HRA = 40% of Basic, Conveyance = 1,600
 * fixed (never more than what's left), Special = the balance. The result sums
 * EXACTLY to gross. This only seeds a structure the owner can then edit — the
 * signed Annexure notes figures "may be restructured", so each employee's four
 * components are stored explicitly on the master record.
 */
export function suggestStructure(grossMonthly: number): SalaryStructure {
  const gross = Math.max(0, Math.round(grossMonthly));
  const basic = Math.round(gross * 0.5);
  const hra = Math.round(basic * 0.4);
  const conveyance = Math.min(1600, Math.max(0, gross - basic - hra));
  const special = gross - basic - hra - conveyance;
  return { basic, hra, conveyance, special, gross };
}

/** Sum an explicit structure (recomputes gross defensively). */
export function structureGross(s: Omit<SalaryStructure, "gross">): number {
  return s.basic + s.hra + s.conveyance + s.special;
}

/**
 * Prorate a monthly structure for loss-of-pay days: each component scales by
 * (standardDays - lopDays) / standardDays, rounded per component, with Special
 * Allowance absorbing the rounding remainder so the prorated components sum
 * EXACTLY to the prorated gross. With lopDays = 0 the input is returned as-is
 * (the signed Diya slips pay the full month when LOP is 0, regardless of a
 * mid-month joining date -- proration keys off LOP only).
 */
export function prorateStructure(s: SalaryStructure, lopDays: number, standardDays: number): SalaryStructure {
  const lop = Math.max(0, Math.min(Math.round(lopDays), standardDays));
  if (lop === 0 || standardDays <= 0) return s;
  const factor = (standardDays - lop) / standardDays;
  const gross = Math.round(s.gross * factor);
  const basic = Math.round(s.basic * factor);
  const hra = Math.round(s.hra * factor);
  const conveyance = Math.round(s.conveyance * factor);
  const special = gross - basic - hra - conveyance; // absorbs rounding
  return { basic, hra, conveyance, special, gross };
}

// --- Statutory deductions ----------------------------------------------------
//
// The owner selects which components apply WHEN GENERATING each payslip (none
// are active today). PF/ESI are auto-computed from the structure; PT/TDS are
// entered amounts (PT slab is state-specific; monthly TDS depends on the
// employee's full annual projection — neither is safe to auto-derive here).
// Every line still renders (0.00 when off), matching the signed payslip.

export type DeductionConfig = {
  /** Employee Provident Fund: 12% of Basic, optionally capped at the 15,000 wage ceiling. */
  pf?: { enabled: boolean; capAtWageCeiling?: boolean };
  /** ESI: 0.75% of Gross, applicable only while Gross <= 21,000. */
  esi?: { enabled: boolean };
  /** Professional Tax: entered amount (UP levies none; default 0). */
  pt?: { enabled: boolean; amount?: number };
  /** Income Tax (TDS): entered monthly amount. */
  tds?: { enabled: boolean; amount?: number };
};

export type Deductions = {
  pf: number;
  esi: number;
  pt: number;
  tds: number;
  total: number;
};

const EPF_WAGE_CEILING = 15000; // statutory PF wage ceiling
const ESI_GROSS_LIMIT = 21000; // ESI applies only at/below this monthly gross

export function computeDeductions(s: SalaryStructure, cfg: DeductionConfig = {}): Deductions {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let pf = 0;
  if (cfg.pf?.enabled) {
    const base = cfg.pf.capAtWageCeiling ? Math.min(s.basic, EPF_WAGE_CEILING) : s.basic;
    pf = round2(base * 0.12);
  }

  let esi = 0;
  if (cfg.esi?.enabled && s.gross <= ESI_GROSS_LIMIT) {
    esi = round2(s.gross * 0.0075);
  }

  const pt = cfg.pt?.enabled ? round2(Math.max(0, cfg.pt.amount ?? 0)) : 0;
  const tds = cfg.tds?.enabled ? round2(Math.max(0, cfg.tds.amount ?? 0)) : 0;

  return { pf, esi, pt, tds, total: round2(pf + esi + pt + tds) };
}

// --- Money formatting + amount in words (Indian system) ----------------------

/** "INR 30,000.00" — en-IN grouping, ASCII prefix (matches enterprise invoices). */
export function formatINR(amount: number): string {
  const grouped = (Number(amount) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `INR ${grouped}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  let out = "";
  if (n >= 100) {
    out += ONES[Math.floor(n / 100)] + " Hundred";
    n %= 100;
    if (n) out += " ";
  }
  if (n >= 20) {
    out += TENS[Math.floor(n / 10)];
    n %= 10;
    if (n) out += " " + ONES[n];
  } else if (n > 0) {
    out += ONES[n];
  }
  return out;
}

/** Integer rupees -> words, Indian grouping (crore/lakh/thousand). Exported so
 * the offer letter can render the "(Rupees Three Lakh Sixty Thousand only)"
 * style used on the signed appointment letters. */
export function rupeesToWords(rupees: number): string {
  if (rupees <= 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(belowThousand(crore) + " Crore");
  if (lakh) parts.push(belowThousand(lakh) + " Lakh");
  if (thousand) parts.push(belowThousand(thousand) + " Thousand");
  if (rupees) parts.push(belowThousand(rupees));
  return parts.join(" ");
}

/**
 * "Indian Rupees Thirty Thousand Only" — the exact style on the signed
 * payslips' NET PAY band. Appends paise when non-zero.
 */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let s = "Indian Rupees " + rupeesToWords(rupees);
  if (paise > 0) s += " and " + rupeesToWords(paise) + " Paise";
  return s + " Only";
}

// --- Assembled payslip -------------------------------------------------------

export type PayslipEmployee = {
  name: string;
  employeeId: string; // e.g. SSS/EMP/0007
  designation: string;
  department: string;
  dateOfJoining: string; // display string, e.g. "02 March 2026"
  pan?: string;
  bankAccount?: string;
  bankBranch?: string;
  ifsc?: string;
  paymentMode?: string; // default "Bank Transfer"
  uanPf?: string; // "Not Applicable" when none
};

export type PayPeriod = {
  monthLabel: string; // "March 2026"
  periodLabel: string; // "02 - 31 March 2026"
  standardDays: number;
  daysPaid: number;
  lopDays: number;
  payDate: string; // "08 April 2026"
};

export type Payslip = {
  employee: PayslipEmployee;
  period: PayPeriod;
  earnings: SalaryStructure;
  deductions: Deductions;
  netPay: number;
  netPayWords: string;
  remarks?: string;
  ptNote: boolean; // show the "UP does not levy Professional Tax" note
};

/** Assemble the full payslip: earnings - deductions = net, plus words. */
export function buildPayslip(input: {
  employee: PayslipEmployee;
  period: PayPeriod;
  earnings: SalaryStructure;
  deductionConfig?: DeductionConfig;
  remarks?: string;
}): Payslip {
  const deductions = computeDeductions(input.earnings, input.deductionConfig);
  const netPay = Math.round((input.earnings.gross - deductions.total) * 100) / 100;
  return {
    employee: {
      paymentMode: "Bank Transfer",
      uanPf: "Not Applicable",
      ...input.employee,
    },
    period: input.period,
    earnings: input.earnings,
    deductions,
    netPay,
    netPayWords: amountInWords(netPay),
    remarks: input.remarks,
    ptNote: !PROFESSIONAL_TAX_LEVIED_IN_STATE && !(input.deductionConfig?.pt?.enabled),
  };
}
