import { gstin, registeredAddress, COMPANY } from "./company";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export type LineItem = {
  description: string;
  qty: number;
  rate: number;
  amount: number; // qty * rate
};

export type Invoice = {
  invId: string;
  clientName: string;
  clientEmail: string;
  clientGstin: string;
  clientAddress: string;
  description: string; // top-level summary
  lineItems: LineItem[];
  amount: number; // pre-tax total
  gstRate: number; // 0 or 18
  gstAmount: number;
  totalAmount: number;
  currency: "INR";
  issueDate: string; // YYYY-MM-DD
  dueDate: string;
  status: InvoiceStatus;
  paidDate?: string;
  paidAmount?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
};

export const STATUS_COLORS: Record<InvoiceStatus, { bg: string; fg: string }> = {
  draft: { bg: "#f1f3f7", fg: "#5b6676" },
  sent: { bg: "#dbeafe", fg: "#1e40af" },
  paid: { bg: "#dcfce7", fg: "#15803d" },
  overdue: { bg: "#fee2e2", fg: "#b91c1c" },
};

export function computeGst(amount: number, gstRate: number) {
  const gstAmount = Math.round((amount * gstRate) / 100);
  return { gstAmount, totalAmount: amount + gstAmount };
}

export function inferStatus(inv: Pick<Invoice, "status" | "dueDate" | "paidDate">): InvoiceStatus {
  if (inv.status === "paid" || inv.paidDate) return "paid";
  if (inv.dueDate && inv.dueDate < new Date().toISOString().slice(0, 10) && inv.status === "sent") return "overdue";
  return inv.status;
}

export function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

/** Payment details to show on the invoice (your IDFC account). */
export const PAYMENT_DETAILS = {
  bankName: "IDFC FIRST Bank",
  accountName: COMPANY.legalName,
  // Fill these from your actual IDFC account once you want them on the invoice face.
  accountNo: process.env.IDFC_ACCOUNT_NO ?? "",
  ifsc: process.env.IDFC_IFSC ?? "",
  upi: process.env.IDFC_UPI ?? "",
};

export function invoiceSellerBlock() {
  return {
    legalName: COMPANY.legalName,
    gstin: gstin(),
    address: registeredAddress(),
    pan: COMPANY.pan,
    email: COMPANY.email,
    phone: COMPANY.phone,
    website: COMPANY.website,
  };
}
