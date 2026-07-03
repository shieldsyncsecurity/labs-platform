<!-- TEMPLATE — copy this file to BOTH:
       labs-platform/app/content/labs/<slug>/instructions.md   (the copy that actually ships)
       labs-platform/labs/<slug>/instructions.md                (engine-side reference copy)
     See LAB-FACTORY.md section 4 for the full syntax reference this skeleton follows.
     Delete this comment block before shipping. -->

## The scenario

TODO — 1-2 paragraphs. What's broken, who broke it, why it matters. Match the tone
of the two live labs: concrete, a little narrative ("a small team shipped fast and
left..."), not a dry spec.

## What you'll do

TODO — one short paragraph naming the N things the learner will fix/prove, matching
the count and wording of this lab's `successCriteria`.

**Launch the lab** (panel on the right) to spin up your own isolated AWS account —
the full step-by-step walkthrough unlocks the moment it's ready.

<!-- ss:walkthrough -->
<!-- Everything ABOVE this sentinel is the OVERVIEW: shipped to ALL visitors,
     including anonymous ones, for BOTH free and paid labs. Everything BELOW is the
     WALKTHROUGH: for a PAID lab (free: false in lab.json), this is gated behind an
     entitlement check and only fetched after launch. A FREE lab ships everything
     regardless of this sentinel. If you omit this sentinel entirely, the code falls
     back to splitting at the first "## Step" heading — and if there's no such
     heading either, NOTHING is gated. Always include this sentinel explicitly for
     any paid lab. -->

:::refcard
**Your environment** — the Session Engine fills in the real names.

| Role | Name |
|---|---|
| TODO — e.g. "Public via policy" | `TODO-OutputKeyFromTemplateYaml` |
| TODO | `TODO` |

TODO — any "don't do X, you're graded on Y not removing it" warning, if applicable.
:::

## Step 1 — TODO short imperative title

<!-- Step headings MUST match exactly: "## Step " + number + one of — – - + title.
     Three places in the codebase parse this exact pattern and must agree:
     app/components/lab-guide.tsx (STEP_HEADING_RE, splitWalkthroughIntoSteps) and
     app/app/labs/[slug]/page.tsx (extractStepTitles). Do not deviate from the
     "## Step N — Title" shape. -->

TODO — one short sentence: what this step accomplishes and why, before the
console/CLI tracks below.

🖱️ **Console**

<!-- A line starting with the 🖱️ emoji opens a "console track" block that runs
     until the next 🖱️/⌨️ marker, the next "## " heading, or a "---" rule. Use
     ">>" for a clickable breadcrumb and "[[Label]]" for a button-chip — BOTH are
     rewritten client-side ONLY inside console-track text (never inside CLI text,
     so a real ">>" in a bash redirect is safe). -->

1. TODO — describe the first console action.

   >> TODO-Service › TODO-resource › TODO-tab

   TODO — what to look for / note once there.

2. Click [[TODO-Button]], TODO-describe-the-change, then [[TODO-Save-or-Confirm]].

⌨️ **CLI (CloudShell):**

<!-- CLI-track code fences get a dark terminal wrapper + copy button automatically.
     No special syntax needed beyond normal fenced code blocks. -->

```bash
# TODO — the exact aws CLI command(s) that accomplish the same fix as the console
# steps above. Use <angle-bracket> placeholders for values the Session Engine
# fills in (real bucket names, user names, etc.) — match the refcard table above.
aws TODO-service TODO-action --TODO-flag <TODO-placeholder>
```

## Step 2 — TODO next step title

TODO — repeat the 🖱️/⌨️ pattern for each remaining fix. Both existing labs use
2-5 steps; keep each step to ONE coherent fix so the step-through UI (one step
shown at a time) stays digestible.

---

## Check your work

Click **Check my work** in the right-hand panel — it inspects your **live** account
against the objectives and shows a pass/fail per item. TODO — optionally add a
self-check block for learners who want to verify without the grader button:

🖱️ **Console**

- TODO — what a fixed resource looks like in the console (e.g. "bucket row now
  reads 'Not public'").

⌨️ **CLI:**

```bash
# TODO — one or two commands that spot-check the fixed state directly.
```

## Hints

- TODO — 3-5 hints, easiest/most-general first, most-specific/unblocking last.
  Match the S3/IAM labs' style: a specific command or the exact console panel name,
  not a vague nudge.

## Cleanup

Nothing to do — when your session ends the account is wiped (`aws-nuke`) and
returned to the pool. There's no bill to worry about.

<!-- If this lab genuinely has learner-triggered cleanup steps beyond session end
     (unusual — neither existing lab does), document them here instead of this
     boilerplate line. -->
