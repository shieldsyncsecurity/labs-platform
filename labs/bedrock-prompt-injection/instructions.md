# Secure the Bedrock Assistant (Prompt Injection & Guardrails)

**Level:** Beginner · **Free lab** · **~35 min** · Region: us-east-1

> NOTE (author reference only): per LAB-FACTORY.md section 4, this engine-side
> copy is NOT read by anything at runtime — only `template.yaml` and `lab.json`
> under `labs-platform/labs/<slug>/` are read by the engine. The instructions.md
> that actually ships to learners is
> `labs-platform/app/content/labs/bedrock-prompt-injection/instructions.md`.
> This copy is kept for author-reference parity with the two existing labs,
> which both keep an (older/plainer) copy here too.

## Before you start — your workspace (30-second read)

You've got two things side by side:

- **This guide** — the scenario, the steps, and the **Check my work** button (right-hand panel).
- **A real, throwaway AWS account** — yours for this session, wiped clean when you finish. Nothing here can cost money or touch anything real, so click around freely.

**To open your AWS account:** click **Open AWS console** (top of the right panel). It opens the real AWS Console in a **new browser tab**.

> ⚠️ **AWS allows only one console session per browser.** If you're already signed into your *own* AWS account, the lab tab will say *"you must log out first."* Two easy fixes: open the lab console in an **incognito / private window** (use the **Copy URL for incognito** button next to the console link), or sign out of your own AWS first.

**There are two ways to do every fix below — pick whichever you prefer:**
- 🖱️ **Console (point-and-click)** — do it in the AWS web UI. Best if you're newer to AWS.
- ⌨️ **CLI** — run commands in **CloudShell** (the `>_` terminal icon in the AWS console's top bar). Faster once you're comfortable.

## Scenario

A startup shipped a Bedrock-backed customer-support assistant (a Lambda calling
Amazon Bedrock **Nova Lite**, `amazon.nova-lite-v1:0`, in `us-east-1`) fast, and
it's insecure in three ways:

1. **No Bedrock Guardrail** is attached — the only thing stopping the assistant
   from leaking its restricted "internal notes" is a soft instruction in the
   system prompt.
2. **The invoke role is over-broad** — `bedrock:*` on `Resource: "*"` instead
   of `bedrock:InvokeModel` scoped to the one model it actually calls.
3. **No model-invocation logging** — no audit trail of what was asked or
   returned.

The Session Engine has filled in your environment's real names:

| What | Value |
|---|---|
| Support assistant Lambda | `SupportAssistantFunctionName` |
| Model | `amazon.nova-lite-v1:0` |
| Over-broad invoke role | `AssistantRoleName` (path `/lab/`) |
| Nova Lite model ARN | `ModelArn` |

> Don't delete the Lambda or the role — you're graded on **fixing** them, not removing them.

## Your mission (the grader checks these)

1. **Guardrail attached** — a Bedrock Guardrail exists with a denied-topic/content policy.
2. **Invoke least privilege** — the assistant role allows `bedrock:InvokeModel` scoped to the Nova Lite model ARN only, no `bedrock:*`, no `Resource: "*"`.
3. **Model logging enabled** — model-invocation logging is configured with a destination.

Before fixing anything: **prove the vulnerability first** by prompt-injecting
the assistant into revealing its restricted internal notes (this step isn't
graded — it's there so you see the actual risk before you close it).

---

## Step-by-step

See the app-side instructions.md (linked above) for the full walkthrough with
console/CLI tracks — Steps 1-2 are recon/break (prompt injection, ungraded),
Steps 3-5 are the three graded fixes (Guardrail, least-privilege IAM,
invocation logging), Step 6 re-verifies the injection is now blocked.

## Hints

- A system-prompt instruction is advisory, not enforced — only a Guardrail's policy is checked independently of the model.
- A guardrail needs a published **version**, not just `DRAFT`, to be usable.
- Scope IAM the same way you would for any service: one action, one resource ARN, not a service-wide wildcard on `*`.

## Cleanup

Nothing to do — when your session ends, your account is wiped clean automatically. There's no bill to worry about.

> Author note: this lab's fix creates a Bedrock Guardrail and a
> model-invocation logging configuration that are **not** part of
> `template.yaml` and therefore are **not** removed by a normal stack delete —
> see the large comment block at the top of `template.yaml`'s Description for
> the required teardown extension (flagged, not yet implemented).
