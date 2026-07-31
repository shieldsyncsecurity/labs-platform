// POSH policy — the company's written policy under the Sexual Harassment of
// Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.
//
// WHY THIS EXISTS AT THREE EMPLOYEES. The 10-worker threshold in s.4 is the
// trigger for constituting an INTERNAL Committee — it is not an exemption from
// the Act. Under s.6 the district Local Committee handles complaints where
// there is no IC, and it handles a complaint made against the EMPLOYER at any
// headcount. The s.19 employer duties (safe workplace, display the LC details
// and the penal consequences, run awareness, assist the complainant) apply
// regardless of size, and s.26 penalises non-compliance with a fine up to
// INR 50,000, doubled on repetition, with licence/registration consequences.
//
// Rendered by components/PolicyDoc. Three destinations, one source:
//   1. the portal (issued + acknowledged per employee)
//   2. printed and displayed at the office  <- the actual s.19(b) obligation
//   3. referenced by one line in the offer/appointment letters

import { COMPANY, DEFAULT_SIGNATORY, LOCAL_COMMITTEE, localCommitteeKnown } from "../company";

export type PolicyDocument = {
  ref: string;
  title: string;
  version: string;
  effectiveDate: string;
  preamble: string;
  sections: Array<{ n: number; heading: string; intro?: string; bullets?: string[] }>;
  /** Rendered in a bordered callout — the s.19(b) "penal consequences" display. */
  displayNotice: string[];
  acknowledgement: string;
  signatory: { name: string; designation: string };
};

export function poshRef(year: number): string {
  return `SSS/POL/${year}/POSH-01`;
}

function localCommitteeLines(): string[] {
  if (!localCommitteeKnown()) {
    return [
      `[ LOCAL COMMITTEE CONTACT NOT SET — obtain the Local Committee details for ${LOCAL_COMMITTEE.district} from the District Officer and record them before displaying or issuing this policy. ]`,
    ];
  }
  const l = [`Local Committee, ${LOCAL_COMMITTEE.district}`];
  if (LOCAL_COMMITTEE.officer) l.push(LOCAL_COMMITTEE.officer);
  if (LOCAL_COMMITTEE.address) l.push(LOCAL_COMMITTEE.address);
  if (LOCAL_COMMITTEE.phone) l.push(`Telephone: ${LOCAL_COMMITTEE.phone}`);
  if (LOCAL_COMMITTEE.email) l.push(`Email: ${LOCAL_COMMITTEE.email}`);
  return l;
}

export function buildPoshPolicy(opts: { ref: string; effectiveDate: string }): PolicyDocument {
  return {
    ref: opts.ref,
    title: "POLICY ON PREVENTION OF SEXUAL HARASSMENT AT THE WORKPLACE",
    version: "1.0",
    effectiveDate: opts.effectiveDate,
    preamble: `${COMPANY.legalName} ("the Company") is committed to a workplace in which every person is treated with dignity and respect, and in which sexual harassment is neither tolerated nor ignored. This policy is issued under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 ("the Act") and the rules made under it. It applies to everyone at the Company without exception, including the founder and management.`,
    sections: [
      {
        n: 1,
        heading: "Who and Where This Covers",
        bullets: [
          "Every person engaged by the Company — employees, interns, trainees, consultants, contractors, and anyone working on the Company's premises or on its behalf, whether paid or unpaid and whatever the terms of engagement.",
          "Every place that counts as the workplace: the Company's offices, any client or third-party site visited for work, any location visited during and arising out of work (including travel and transport arranged for work), and work-related events.",
          "Digital and remote settings equally — email, chat, calls, video meetings, and messaging, at any hour, where the conduct arises out of the working relationship.",
          "A complaint may be made by any woman covered above, whether or not she is an employee of the Company.",
        ],
      },
      {
        n: 2,
        heading: "What Sexual Harassment Means",
        intro:
          "Sexual harassment includes any one or more of the following unwelcome acts or behaviour, whether directly or by implication (s.2(n) of the Act):",
        bullets: [
          "Physical contact and advances.",
          "A demand or request for sexual favours.",
          "Making sexually coloured remarks.",
          "Showing pornography.",
          "Any other unwelcome physical, verbal, or non-verbal conduct of a sexual nature.",
          "It is also sexual harassment where any of the following is connected to such conduct (s.3): an implied or explicit promise of preferential treatment; a threat of detrimental treatment; a threat about present or future employment status; interference with work or the creation of an intimidating, offensive, or hostile working environment; or humiliating treatment likely to affect health or safety.",
          "The test is whether the conduct was UNWELCOME to the person receiving it — not whether the person doing it intended offence, and not whether others would have minded.",
        ],
      },
      {
        n: 3,
        heading: "Consent, Authority, and Personal Relationships",
        bullets: [
          "Where one person controls another's pay, appraisal, continued engagement, certificate, or reference, apparent consent cannot be assumed to be free consent. Anyone holding that authority carries the responsibility for keeping the relationship professional.",
          "No one at the Company may make any benefit, opportunity, or continued engagement conditional — expressly or by implication — on a personal or social relationship.",
          "Social invitations connected to work must remain optional in fact as well as in form: declining one must carry no consequence of any kind, and repeated invitations after a refusal are not acceptable.",
        ],
      },
      {
        n: 4,
        heading: "How to Raise a Complaint",
        intro:
          "The Company employs fewer than ten workers, so it has no Internal Committee. Complaints are made to the Local Committee constituted by the District Officer under s.6 of the Act. A complaint against the employer is made to the Local Committee in every case.",
        bullets: [
          ...localCommitteeLines(),
          "A complaint should be made in writing within three (3) months of the incident, or of the last incident in a series. The Local Committee may extend that period by a further three (3) months where it is satisfied that circumstances prevented an earlier complaint.",
          "Where the complainant is unable to make the complaint herself, it may be made on her behalf as permitted by the Act and the rules.",
          "The Company will provide any assistance needed to make a complaint to the Local Committee, including help putting it in writing, and will not require it to be routed through the Company first.",
          `Anyone who would prefer to raise a concern internally in the first instance may write to ${COMPANY.hrEmail}. Raising it internally is optional and does not replace, delay, or affect the right to go directly to the Local Committee.`,
        ],
      },
      {
        n: 5,
        heading: "What Happens Next",
        bullets: [
          "Conciliation may be offered at the complainant's request before any inquiry begins (s.10). No monetary settlement may be made the basis of conciliation, and conciliation is never imposed.",
          "Where the matter proceeds to inquiry, the Act requires it to be completed within ninety (90) days, and action on the recommendations within sixty (60) days of the report.",
          "During the process the complainant may seek interim relief under s.12 — including transfer of either party, leave of up to three months in addition to normal leave, or restraint on the respondent from reporting on her work.",
          "The Company will comply with the Local Committee's recommendations and will take disciplinary action up to and including termination, and will assist the complainant if she chooses to initiate criminal proceedings.",
        ],
      },
      {
        n: 6,
        heading: "Confidentiality and Protection from Retaliation",
        bullets: [
          "The identity of the complainant and the respondent, the witnesses, the contents of the complaint, and the outcome are confidential and must not be published or circulated (s.16). Breaching that confidentiality is itself a punishable contravention.",
          "No person who makes a complaint in good faith, gives evidence, or assists in a proceeding will suffer any detriment for it — in pay, work, appraisal, certificate, reference, or continued engagement. Retaliation is treated as serious misconduct in its own right.",
          "A complaint that cannot be substantiated is NOT a false complaint. Action for a malicious complaint under s.14 requires an inquiry finding that the complaint was made maliciously or with knowingly false evidence; the mere absence of proof is expressly not enough.",
        ],
      },
      {
        n: 7,
        heading: "The Company's Obligations",
        bullets: [
          "Provide a safe working environment, including safety from anyone the complainant comes into contact with at the workplace (s.19).",
          "Display this policy, the penal consequences of sexual harassment, and the Local Committee's contact details at a conspicuous place in the workplace.",
          "Give every person a copy of this policy at the start of their engagement and run periodic awareness on it.",
          "Treat sexual harassment as misconduct under the applicable service rules and act accordingly.",
          "Provide the returns and records the Act and rules require.",
        ],
      },
    ],
    displayNotice: [
      "Sexual harassment at the workplace is prohibited by law.",
      "It is punishable as misconduct under the Company's terms of engagement, and may constitute a criminal offence under s.354A of the Bharatiya Nyaya Sanhita, 2023.",
      "Failure by the employer to comply with the Act is punishable with a fine of up to INR 50,000, doubled on repetition, with consequences for the entity's licence or registration.",
    ],
    acknowledgement:
      "I confirm that I have received and read the Company's Policy on Prevention of Sexual Harassment at the Workplace, that I have had the opportunity to ask questions about it, and that I understand how to raise a complaint.",
    signatory: DEFAULT_SIGNATORY,
  };
}
