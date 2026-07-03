// SNIPPET — not a real module, nothing imports this file. Copy the object below
// into shieldsync-website/lib/site.ts's AWS_LABS array (a separate repo from
// labs-platform — see LAB-FACTORY.md section 1, registration point #3, and
// section 5's H11 note on why this is a third hand-authored copy of the catalog
// rather than something generated/shared).
//
// The comment already sitting above AWS_LABS in that file says it best:
//   "CANONICAL shared fields (slug/title/level/free/tags/minutes) mirror each
//    lab's labs-platform/app/content/labs/<slug>/lab.json — keep them in sync;
//    `desc`, `added`, `skills`, `roles` are marketing-only and live here."
//
// So: slug/title/level/free/tags/minutes MUST match the app-content lab.json
// exactly. desc/added/skills/roles are marketing copy with no other source.

{
  slug: "TODO-slug", // must exactly match labs-platform/labs/<slug> directory name
  title: "TODO Title Case Lab Name", // must match app/content/labs/<slug>/lab.json's title
  level: "TODO-Beginner-or-Intermediate-or-Advanced", // must match lab.json's level
  free: false, // must match lab.json's free
  desc: "TODO — marketing-only, punchier/shorter than lab.json's summary. One sentence, active voice (see the two existing entries: 'Find and fix public buckets, weak ACLs, and missing encryption in a realistic account.').",
  tags: ["TODO", "TODO", "TODO"], // must match lab.json's tags
  added: "TODO-YYYY-MM-DD", // the date this lab goes live — drives sitemap lastmod + "new" badges if any
  minutes: 30, // must match lab.json's estimatedActiveMinutes
  skills: [
    "TODO — marketing-only bullet list, 3-5 items, resume/job-description-shaped phrases (see existing entries: 'S3 Block Public Access & bucket policies', 'Policy analysis with SimulatePrincipalPolicy').",
  ],
  roles: ["TODO Job Title", "TODO Job Title", "TODO Job Title"], // marketing-only — which job titles this lab is relevant practice for
}

// After adding this entry:
//   - Nothing else needs to change for the lab to appear in the labs listing,
//     sitemap, and per-lab SEO/OG/schema.org Course markup — app/labs/page.tsx,
//     app/sitemap.ts, and app/aws-security-certification/page.tsx all iterate
//     AWS_LABS directly.
//   - IF this new lab should be the platform's free lab (unlikely — one already
//     exists), also update the hardcoded FREE_SLUG constant in
//     shieldsync-website/components/labs-wizard.tsx and the
//     slug === "s3-misconfiguration-audit" conditional in
//     shieldsync-website/app/aws-security-certification/page.tsx (~line 264).
//     See LAB-FACTORY.md section 1, registration points #4-5.
