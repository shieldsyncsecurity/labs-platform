# Lab template

Skeleton files for adding a new ShieldSync AWS security lab. **Read
`labs-platform/LAB-FACTORY.md` first** — it's the full how-to guide these files are
scaffolding for; this README only maps the files to what they're for.

## Files in this folder

| File | Copy it to | What it is |
|---|---|---|
| `template.yaml` | `labs-platform/labs/<slug>/template.yaml` | CloudFormation scenario skeleton. |
| `lab.json` | `labs-platform/labs/<slug>/lab.json` | Engine-side lab.json — the one with `learnerPolicy`. |
| `app-content-lab.json` | `labs-platform/app/content/labs/<slug>/lab.json` | App-side lab.json — the SECOND, separate copy that feeds the content build. See LAB-FACTORY.md §5 (H11) for why there are two. |
| `instructions.md` | `labs-platform/app/content/labs/<slug>/instructions.md` | Learner-facing walkthrough — this is the copy that actually ships (see LAB-FACTORY.md §4's note on the engine-side `instructions.md` being reference-only). Also copy to `labs-platform/labs/<slug>/instructions.md` for consistency, but know only the app-content copy is read at runtime. |
| `learnerPolicy.json` | (reference only — not copied anywhere) | Annotated worked-example for drafting the `learnerPolicy` Statement array before pasting the finished array into `lab.json`. |
| `grader.skeleton.mjs` | (reference only — copy the function INTO `engine/graders.mjs`) | Skeleton for the per-lab grading function + dispatch wiring. |
| `marketing-catalog-entry.snippet.ts` | (reference only — copy the object INTO `shieldsync-website/lib/site.ts`'s `AWS_LABS` array) | The third catalog registration point, in the separate marketing-site repo. |

## Quick start

```
cp -r labs-platform/labs/_template labs-platform/labs/my-new-lab
cd labs-platform/labs/my-new-lab
rm README.md learnerPolicy.json grader.skeleton.mjs marketing-catalog-entry.snippet.ts app-content-lab.json
# (those four/five are reference-only or need to land in a different directory —
#  see the table above and LAB-FACTORY.md §6 for the exact destinations)
```

Then follow **LAB-FACTORY.md §6 "Step-by-step: adding lab N"** end to end,
including the four verification gates before calling the lab done:
1. Deploys clean.
2. Grades correctly on the broken (freshly-deployed) state — everything `passed: false`.
3. Grades correctly on the fixed state — everything `passed: true`, checked via both the console and CLI track.
4. The learner session policy blocks out-of-scope actions (`engine/verify-leastpriv.mjs`, probes edited for this lab).

## Do not skip

- Every `id` in `successCriteria` (both lab.json copies) must exactly match the
  `id` your grader function in `engine/graders.mjs` returns — nothing type-checks
  this link.
- `learnerPolicy` (engine-side lab.json only) is enforced by a **build-time hard
  gate** (`app/scripts/build-lab-content.mjs`) for any lab with a `template.yaml` —
  missing or empty fails the whole app build, not just this lab.
- The marketing-site `AWS_LABS` entry is a fully separate, hand-authored copy in a
  different repo (`shieldsync-website/lib/site.ts`) — nothing fails loudly if you
  forget it, the lab just silently doesn't appear on the marketing site.

Full detail, exact regexes, naming conventions, and the catalog-duplication map:
**`labs-platform/LAB-FACTORY.md`**.
