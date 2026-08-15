import { gstin, registeredAddress, COMPANY } from "./company";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export type LineItem = {
  description: string;
  qty: number;
  rate: number;
  amount: number;
};

export type Invoice = {
  invId: string;
  clientName: string;
  clientEmail: string;
  clientGstin: string;
  clientAddress: string;
  description: string;
  lineItems: LineItem[];
  amount: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
  currency: "INR";
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  paidDate?: string;
  paidAmount?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export function inferStatus(inv: Pick<Invoice, "status" | "dueDate" | "paidDate">): InvoiceStatus {
  if (inv.status === "paid" || inv.paidDate) return "paid";
  if (inv.dueDate && inv.dueDate < new Date().toISOString().slice(0, 10) && inv.status === "sent") return "overdue";
  return inv.status;
}

export function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export const PAYMENT_DETAILS = {
  bankName: "IDFC FIRST Bank",
  accountName: COMPANY.legalName,
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
