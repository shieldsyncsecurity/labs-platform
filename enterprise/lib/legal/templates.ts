// Versioned plain-text legal templates for the agreements system (sprint W3-3).
//
// HARD CONSTRAINTS (see SPRINT-2026-07-09.md):
// - ASCII ONLY. "INR", never the rupee sign; straight quotes; "--" not em-dash.
//   The PDF writer (lib/pdf/text-pdf.ts) uses WinAnsi Helvetica and the whole
//   pipeline assumes ASCII; keep it that way.
// - Every rendered document carries the vN-DRAFT banner as its FIRST line until
//   the owner's legal review blesses a version (then bump TEMPLATE_VERSION to
//   "v1" and drop the banner in the same change).
// - Lines starting with "# " are section heads -- the PDF writer renders them
//   bold 14pt, so keep that convention when editing.
//
// This module is intentionally dependency-free and side-effect-free so it can
// be imported from server components, Route Handlers, and the admin UI alike.

export const TEMPLATE_VERSION = "v1-DRAFT";

export type AgreementDocType = "msa" | "dpa";

export type AgreementParams = {
  companyLegalName: string;
  registeredAddress: string;
  /** Optional -- rendered as "Not provided" when absent. */
  gstin?: string;
  signatoryName: string;
  signatoryTitle: string;
  /** Plain-text date, e.g. "9 July 2026". */
  effectiveDate: string;
  /** e.g. "India" / "the Republic of India". */
  governingLaw: string;
};

/** Params that renderTemplate refuses to proceed without. */
export const MANDATORY_PARAM_KEYS = [
  "companyLegalName",
  "registeredAddress",
  "signatoryName",
  "signatoryTitle",
  "effectiveDate",
  "governingLaw",
] as const;

export const DOC_TYPE_LABELS: Record<AgreementDocType, string> = {
  msa: "Enterprise Agreement",
  dpa: "Data Processing Agreement",
};

const DRAFT_BANNER =
  "# THIS IS A " + TEMPLATE_VERSION + " TEMPLATE PENDING SHIELDSYNC LEGAL REVIEW.";

// ---------------------------------------------------------------------------
// Enterprise Agreement (docType "msa")
// ---------------------------------------------------------------------------

const ENTERPRISE_AGREEMENT_TEMPLATE = `${DRAFT_BANNER}

# ENTERPRISE AGREEMENT (${TEMPLATE_VERSION})

This Enterprise Agreement ("Agreement") is entered into on {{effectiveDate}}
("Effective Date") between:

ShieldSync Security Private Limited ("ShieldSync"), provider of the ShieldSync
Enterprise assessment platform at enterprise.shieldsyncsecurity.com; and

{{companyLegalName}}, having its registered address at {{registeredAddress}}
(GSTIN: {{gstin}}) ("Customer").

Accepted for the Customer by {{signatoryName}}, {{signatoryTitle}}.

# 1. SERVICES

1.1 ShieldSync provides a hosted, hands-on technical assessment platform (the
"Service"): the Customer creates assessments, invites candidates, and receives
scored reports based on candidates' work in live cloud lab environments.

1.2 The Service is provided on a standard, universal basis. Feature behaviour
is identical for all customers; only the commercial and legal terms recorded
in this Agreement vary.

1.3 ShieldSync will provide the Service with reasonable skill and care and
will use commercially reasonable efforts to keep the Service available,
excluding planned maintenance and events outside ShieldSync's reasonable
control. The Service is provided without a contractual uptime guarantee at
this stage; any service-level commitments must be agreed in writing.

# 2. CREDITS, FEES AND PAYMENT

2.1 The Service is consumed through prepaid assessment credits. One candidate
invite consumes one credit unless otherwise stated in the applicable order.

2.2 Credits are purchased by written or emailed order. ShieldSync issues a tax
invoice for each order; the Customer will pay each invoice within thirty (30)
days of the invoice date by bank transfer to the account named on the invoice.

2.3 All fees are stated in INR and are exclusive of taxes. GST and any other
applicable taxes will be added to invoices at the prevailing rate. The
Customer is responsible for withholding taxes only to the extent required by
law, and will gross up payments where a valid exemption is not provided.

2.4 Credits are non-refundable except where required by law or expressly
agreed in an order, and expire twenty-four (24) months after purchase unless
the applicable order states otherwise.

# 3. CUSTOMER RESPONSIBILITIES

3.1 The Customer will: (a) only invite candidates who are genuinely under
consideration for a role or engagement with the Customer; (b) provide accurate
candidate contact details; (c) keep portal sign-in credentials confidential;
and (d) not attempt to probe, disrupt, or reverse engineer the Service or the
lab environments beyond the activities an assessment legitimately requires.

3.2 The Customer is responsible for its own hiring decisions. Assessment
scores and reports are one input among others; ShieldSync does not make, and
is not responsible for, any employment decision.

# 4. CANDIDATE DATA AND DPDP ROLES

4.1 For candidate personal data processed in connection with the Customer's
assessments, and for the purposes of the Digital Personal Data Protection
Act, 2023 (India) ("DPDP Act"): the Customer is the Data Fiduciary in respect
of its candidates and its hiring decisions, and ShieldSync processes such
candidate data on the Customer's behalf for assessment delivery, scoring and
reporting (acting in the role commonly described as a data processor).

4.2 The parties' detailed data-protection obligations are set out in the Data
Processing Agreement ("DPA") issued alongside this Agreement. If there is a
conflict between this Agreement and the DPA on data-protection matters, the
DPA prevails.

4.3 ShieldSync collects candidate consent to assessment-related processing at
the start of each assessment. The Customer remains responsible for the lawful
basis of its own decision to assess and evaluate the candidate.

# 5. SUB-PROCESSORS

5.1 The Customer authorises ShieldSync to use the following sub-processors in
delivering the Service: Amazon Web Services (hosting, storage and lab
infrastructure), Amazon Simple Email Service (transactional email), and --
where AI-assisted evaluation features are enabled for the Customer -- Google
Gemini (AI evaluation). ShieldSync will give reasonable prior notice of new
sub-processors as described in the DPA.

# 6. DATA RETENTION AND ERASURE

6.1 Candidate assessment records are retained for twenty-four (24) months
from creation, after which they are deleted or irreversibly anonymised in the
ordinary course.

6.2 The Customer or a candidate may request earlier erasure of a candidate's
personal data. ShieldSync will action verified erasure requests without undue
delay; erasure also revokes any candidate-facing report links.

# 7. CONFIDENTIALITY

7.1 Each party will keep confidential all non-public information disclosed by
the other party in connection with this Agreement, use it only to perform
this Agreement, and protect it with at least the care it uses for its own
confidential information (and never less than reasonable care).

7.2 Confidentiality obligations do not apply to information that is or
becomes public through no fault of the recipient, was lawfully known before
disclosure, is independently developed, or must be disclosed by law (with
prompt notice to the discloser where lawful). These obligations survive for
three (3) years after termination; candidate personal data remains governed
by the DPA and applicable law without time limit.

# 8. INTELLECTUAL PROPERTY

8.1 ShieldSync retains all rights in the Service, the lab content, scoring
logic and reports' format and structure. The Customer retains all rights in
its own data. The Customer receives a non-exclusive, non-transferable right
to use reports internally for its hiring and evaluation purposes.

# 9. WARRANTIES AND DISCLAIMER

9.1 Each party warrants it has the authority to enter into this Agreement.
Except as expressly stated in this Agreement, the Service is provided "as
is" and ShieldSync disclaims all other warranties, express or implied,
including fitness for a particular purpose, to the maximum extent permitted
by law.

# 10. LIABILITY

10.1 Neither party is liable for indirect, incidental, special or
consequential loss, or loss of profits, revenue or data, arising out of this
Agreement.

10.2 Each party's total aggregate liability arising out of or in connection
with this Agreement is capped at the fees paid by the Customer to ShieldSync
in the twelve (12) months preceding the event giving rise to the claim.

10.3 Nothing in this Agreement excludes or limits liability that cannot be
excluded or limited under applicable law, including liability for fraud.

# 11. TERM AND TERMINATION

11.1 This Agreement starts on the Effective Date and continues until
terminated. Either party may terminate for convenience on thirty (30) days'
written notice, or immediately on written notice if the other party
materially breaches this Agreement and fails to cure within fifteen (15)
days of notice of the breach.

11.2 On termination: unused credits lapse (except as required by law or
agreed in an order); the Customer retains access to already-generated reports
for sixty (60) days; and candidate data is handled as set out in the DPA and
Section 6.

# 12. GENERAL

12.1 This Agreement, the DPA and any orders form the entire agreement between
the parties on this subject and supersede prior discussions. Amendments must
be agreed in writing (including by the issue-and-accept mechanism of the
ShieldSync portal).

12.2 Neither party may assign this Agreement without the other's written
consent, except to an affiliate or in connection with a merger or sale of
substantially all assets, with notice.

12.3 This Agreement is governed by the laws of {{governingLaw}}, and the
courts at Mumbai, India have exclusive jurisdiction, subject to any mandatory
law to the contrary.

# EXECUTION

Accepted electronically through the ShieldSync Enterprise portal.

Customer: {{companyLegalName}}
Signatory: {{signatoryName}}, {{signatoryTitle}}
Effective Date: {{effectiveDate}}
`;

// ---------------------------------------------------------------------------
// Data Processing Agreement (docType "dpa")
// ---------------------------------------------------------------------------

const DPA_TEMPLATE = `${DRAFT_BANNER}

# DATA PROCESSING AGREEMENT (${TEMPLATE_VERSION})

This Data Processing Agreement ("DPA") is entered into on {{effectiveDate}}
between ShieldSync Security Private Limited ("ShieldSync") and
{{companyLegalName}}, having its registered address at {{registeredAddress}}
(GSTIN: {{gstin}}) ("Customer"), and forms part of the Enterprise Agreement
between the parties.

Accepted for the Customer by {{signatoryName}}, {{signatoryTitle}}.

# 1. ROLES AND SCOPE

1.1 For candidate personal data processed for the Customer's assessments
under the Digital Personal Data Protection Act, 2023 (India) and other
applicable data-protection law: the Customer is the Data Fiduciary in respect
of its candidates and its hiring decisions; ShieldSync processes candidate
personal data on the Customer's behalf and instructions (the role commonly
described as a data processor).

1.2 This DPA applies to all candidate personal data ShieldSync processes for
the Customer through the ShieldSync Enterprise platform.

# 2. PROCESSING DETAILS

2.1 Subject matter: delivery of hands-on technical assessments to candidates
nominated by the Customer.

2.2 Purpose: creating and sending candidate invites; running assessment lab
sessions; scoring candidate work; generating and serving assessment reports;
and related support, security and troubleshooting.

2.3 Categories of data: candidate name and email address; assessment
scheduling data; candidate activity and work product within the assessment
lab; scores and evaluations; and technical logs generated during a session.

2.4 Duration: for the term of the Enterprise Agreement, subject to the
retention and deletion terms in Sections 6 and 7.

2.5 ShieldSync will process candidate personal data only for the purposes
above and on the Customer's documented instructions, unless required to do
otherwise by law (in which case ShieldSync will inform the Customer unless
the law prohibits it).

# 3. SECURITY MEASURES

3.1 ShieldSync implements appropriate technical and organisational measures
to protect candidate personal data, including: encryption in transit (TLS)
for all platform traffic; encryption at rest for stored data; isolated,
short-lived cloud lab environments per assessment session; least-privilege
access controls and scoped credentials between platform components;
authenticated, org-scoped access to employer reports with revocable report
links; and logging of administrative actions.

3.2 ShieldSync limits access to candidate personal data to personnel who
need it to deliver the Service and who are bound by confidentiality
obligations.

# 4. PERSONNEL AND ASSISTANCE

4.1 ShieldSync will, taking into account the nature of the processing,
provide reasonable assistance to the Customer in fulfilling its obligations
to respond to candidates' requests to exercise their rights under applicable
data-protection law, including access and erasure requests.

# 5. PERSONAL DATA BREACH

5.1 ShieldSync will notify the Customer without undue delay after becoming
aware of a personal data breach affecting candidate personal data processed
for the Customer, and will provide information reasonably available to
ShieldSync about the nature of the breach, the categories and approximate
number of affected data principals and records, the likely consequences, and
the measures taken or proposed to address the breach and mitigate its
effects. ShieldSync will supplement this information as it becomes available.

5.2 Where the breach requires notification to the Data Protection Board of
India or to affected data principals, the parties will cooperate in good
faith; statutory notification duties remain with the party that carries them
under applicable law.

# 6. SUB-PROCESSORS

6.1 The Customer gives general authorisation for the following
sub-processors: Amazon Web Services (cloud hosting, storage, and assessment
lab infrastructure); Amazon Simple Email Service (transactional candidate
and employer email); and -- only where AI-assisted evaluation features are
enabled for the Customer -- Google Gemini (AI-assisted evaluation of
candidate work).

6.2 ShieldSync will give the Customer at least fifteen (15) days' notice
before adding or replacing a sub-processor that processes candidate personal
data. If the Customer reasonably objects on data-protection grounds and the
parties cannot resolve the objection, the Customer may terminate the affected
Service with a pro-rata treatment of unused credits as its sole remedy.

6.3 ShieldSync remains responsible to the Customer for its sub-processors'
performance of data-protection obligations consistent with this DPA.

# 7. RETENTION, RETURN AND DELETION

7.1 Candidate assessment records are retained for twenty-four (24) months
from creation and then deleted or irreversibly anonymised in the ordinary
course.

7.2 On verified request by the Customer or a candidate, ShieldSync will erase
a candidate's personal data without undue delay. Erasure also revokes any
candidate-facing report links.

7.3 On termination or expiry of the Enterprise Agreement, ShieldSync will,
at the Customer's choice expressed within sixty (60) days, delete candidate
personal data processed for the Customer or make report data available for
export, and will thereafter delete remaining candidate personal data, except
where retention is required by law (in which case the data remains protected
under this DPA and is deleted when the legal requirement ends).

# 8. AUDIT AND INFORMATION

8.1 ShieldSync will make available to the Customer information reasonably
necessary to demonstrate compliance with this DPA, and will respond to the
Customer's reasonable written security questionnaires no more than once per
twelve (12) month period.

# 9. GENERAL

9.1 This DPA prevails over the Enterprise Agreement for data-protection
matters. Liability under this DPA is subject to the liability terms of the
Enterprise Agreement.

9.2 This DPA is governed by the laws of {{governingLaw}}, with the same
jurisdiction terms as the Enterprise Agreement.

# EXECUTION

Accepted electronically through the ShieldSync Enterprise portal.

Customer: {{companyLegalName}}
Signatory: {{signatoryName}}, {{signatoryTitle}}
Effective Date: {{effectiveDate}}
`;

const TEMPLATES: Record<AgreementDocType, string> = {
  msa: ENTERPRISE_AGREEMENT_TEMPLATE,
  dpa: DPA_TEMPLATE,
};

/**
 * Merge params into the versioned template for `docType`.
 *
 * Throws if any mandatory param is missing/blank (lists ALL missing keys in
 * one error so an admin form can surface them together). The optional gstin
 * renders as "Not provided" when absent -- the placeholder must never leak
 * into issued text.
 */
export function renderTemplate(docType: AgreementDocType, params: AgreementParams): string {
  const template = TEMPLATES[docType];
  if (!template) {
    throw new Error(`Unknown agreement docType: ${String(docType)}`);
  }

  const missing = MANDATORY_PARAM_KEYS.filter((key) => {
    const value = params[key];
    return typeof value !== "string" || value.trim() === "";
  });
  if (missing.length > 0) {
    throw new Error(`Missing mandatory agreement params: ${missing.join(", ")}`);
  }

  const values: Record<string, string> = {
    companyLegalName: params.companyLegalName.trim(),
    registeredAddress: params.registeredAddress.trim(),
    gstin: params.gstin?.trim() || "Not provided",
    signatoryName: params.signatoryName.trim(),
    signatoryTitle: params.signatoryTitle.trim(),
    effectiveDate: params.effectiveDate.trim(),
    governingLaw: params.governingLaw.trim(),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      // A placeholder we do not know -- fail loudly rather than issuing a
      // legal document with a literal "{{foo}}" in it.
      throw new Error(`Template references unknown param: ${match}`);
    }
    return value;
  });
}
