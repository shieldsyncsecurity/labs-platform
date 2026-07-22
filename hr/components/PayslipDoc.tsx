import type React from "react";
import { COMPANY } from "@/lib/company";
import { formatINR, type Payslip } from "@/lib/payslip";
import { LETTERHEAD_CSS } from "./letterhead-css";
import { Masthead } from "./Masthead";
import { qrSvg, hrMailto } from "@/lib/qr";

const fmtInt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");
const fmt2 = (n: number) =>
  (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One salary slip, rendered in the owner-approved (Diya) format. */
export function PayslipDoc({ payslip, toolbar }: { payslip: Payslip; toolbar?: React.ReactNode }) {
  const { employee: emp, period: per, earnings: e, deductions: d } = payslip;

  // Scannable QR -> opens a pre-addressed email to HR, subject carrying this
  // slip's month + employee for instant context.
  const qr = qrSvg(hrMailto(COMPANY.hrEmail, `Payslip query - ${emp.name} (${per.monthLabel})`));

  const earnRows = [
    { label: "Basic Salary", amt: e.basic },
    { label: "House Rent Allowance", amt: e.hra },
    { label: "Conveyance Allowance", amt: e.conveyance },
    { label: "Special Allowance", amt: e.special },
  ];
  const dedRows = [
    { label: "Provident Fund", amt: d.pf },
    ...(d.esi > 0 ? [{ label: "Employee State Insurance (ESI)", amt: d.esi }] : []),
    { label: "Professional Tax", amt: d.pt },
    { label: "Income Tax (TDS)", amt: d.tds },
  ];
  const rowCount = Math.max(earnRows.length, dedRows.length);

  const kv: Array<[string, string, string, string]> = [
    ["Employee Name", emp.name, "Employee ID", emp.employeeId],
    ["Designation", emp.designation, "Department", emp.department],
    ["Date of Joining", emp.dateOfJoining, "Pay Period", per.periodLabel],
    ["Standard Days", String(per.standardDays), "Days Paid", String(per.daysPaid)],
    ["LOP Days", String(per.lopDays), "Pay Date", per.payDate],
    ["PAN", emp.pan ?? "-", "Bank A/C No.", emp.bankAccount ?? "-"],
    ["Bank & Branch", emp.bankBranch ?? "-", "IFSC Code", emp.ifsc ?? "-"],
    ["Payment Mode", emp.paymentMode ?? "Bank Transfer", "UAN / PF No.", emp.uanPf ?? "Not Applicable"],
  ];

  return (
    <div className="ss-stage">
      <style dangerouslySetInnerHTML={{ __html: LETTERHEAD_CSS }} />
      {toolbar ? (
        <div className="ss-noprint" style={{ maxWidth: 840, margin: "0 auto 12px" }}>
          {toolbar}
        </div>
      ) : null}

      <div className="ss-sheet">
        <Masthead
          variant="lean"
          rightSlot={
            <div className="ss-qr">
              <div className="code" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="cap">Scan to email HR</div>
            </div>
          }
        />

        <div className="ss-title">
          <h1>SALARY SLIP</h1>
          <div className="sub">For the month of {per.monthLabel}</div>
        </div>

        <table className="ss-kv" style={{ marginTop: 14 }}>
          <tbody>
            {kv.map(([k1, v1, k2, v2], i) => (
              <tr key={i}>
                <td className="k">{k1}</td>
                <td>{v1}</td>
                <td className="k">{k2}</td>
                <td>{v2}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="ss-ded" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th style={{ width: "32%" }}>Earnings</th>
              <th className="amt" style={{ width: "18%" }}>Amount (INR)</th>
              <th style={{ width: "32%" }}>Deductions</th>
              <th className="amt" style={{ width: "18%" }}>Amount (INR)</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }).map((_, i) => (
              <tr key={i}>
                <td>{earnRows[i]?.label ?? ""}</td>
                <td className="amt">{earnRows[i] ? fmtInt(earnRows[i].amt) : ""}</td>
                <td>{dedRows[i]?.label ?? ""}</td>
                <td className="amt">{dedRows[i] ? fmt2(dedRows[i].amt) : ""}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>Gross Earnings</td>
              <td className="amt">{fmtInt(e.gross)}</td>
              <td>Total Deductions</td>
              <td className="amt">{fmt2(d.total)}</td>
            </tr>
          </tbody>
        </table>

        <div className="ss-netpay">
          <span className="lab">NET PAY: {formatINR(payslip.netPay)}</span>
          <span className="words">({payslip.netPayWords})</span>
        </div>

        {payslip.remarks ? (
          <div className="ss-remark">
            <b>Remarks:</b> {payslip.remarks}
          </div>
        ) : null}
        <p className="ss-fine">
          Net Pay = Gross Earnings - Total Deductions.
          {payslip.ptNote ? " Uttar Pradesh does not levy Professional Tax." : ""}
          <br />
          This is a computer-generated salary slip, bearing the company stamp for verification. For
          payroll or verification queries, write to {COMPANY.hrEmail}.
        </p>

        <div className="ss-sig">
          <div className="wrap">
            <img className="ss-stamp" src="/sealed/company-seal.png" alt="Company stamp" />
            <div className="ss-stampcap">Company Stamp — For ShieldSync Security Pvt. Ltd.</div>
          </div>
        </div>

        <div className="ss-foot">
          <span>Salary Slip - {per.monthLabel}</span>
          <span className="c">
            {COMPANY.legalName} | CIN: {COMPANY.cin}
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}
