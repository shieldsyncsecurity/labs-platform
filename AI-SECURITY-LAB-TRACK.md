# AI Security Lab Track — planning spec (draft)

**Status:** design draft for owner (Himanshu) to refine — he is the AI-security author. Claude scaffolds templates, wires graders, tests. Nothing built yet; this is the queue for the lab factory (see LAB-FACTORY.md).

**Why this track wins:** the differentiator is that every objective is **graded against real AWS state** (Bedrock Guardrails config, IAM policies, logging, KB access) — not a quiz. Most "AI security training" can't verify anything; this can. Ties to the SCS-C03 GenAI-security domain and maps to the widely-used LLM risk categories (prompt injection, sensitive-info disclosure, excessive agency, insecure output handling, etc.).

**Platform fit:** all labs run on the existing engine — a real isolated AWS account with Amazon Bedrock. Each is the same authoring effort as an S3/IAM lab (CFN scenario + learnerPolicy + grader + instructions). Bedrock model access must be enabled in the sandbox account's region (one-time engine/account setup task — flag before building lab 1).

---

## The 5-lab track (beginner → advanced)

### Lab 1 — Bedrock prompt injection & Guardrails  *(Beginner)*
- **Scenario:** a deployed Bedrock-backed "support assistant" (Lambda + a system prompt) answers customer questions. Its invoke role is over-broad and it has no Guardrail.
- **Attack (learner does):** craft a prompt-injection / jailbreak that makes the assistant ignore its system prompt and reveal restricted content or call a model it shouldn't.
- **Fix (learner does):** attach a **Bedrock Guardrail** (denied topics + content filters), and scope the Lambda's invoke role to a single model ARN.
- **Grader checks (live):** a Guardrail exists and is associated with the app path; the invoke role's policy is restricted to one `bedrock:InvokeModel` resource (no `*`); model-invocation logging is on.
- **Skills / roles:** GenAI guardrails, least-privilege model access. Maps to prompt-injection + sensitive-info-disclosure risk categories, SCS-C03 GenAI domain.

### Lab 2 — RAG knowledge-base data leakage  *(Intermediate)*
- **Scenario:** a RAG assistant over a Bedrock Knowledge Base backed by an S3 bucket. The bucket / KB is scoped so the assistant can retrieve documents from a directory it shouldn't (e.g. `hr/` or `secrets/`).
- **Attack:** ask questions that surface confidential docs the assistant should never return.
- **Fix:** tighten the S3 access / KB data-source scope (prefix restriction, per-doc access), so only the intended corpus is retrievable.
- **Grader checks:** the retrieval role / KB data source no longer grants the restricted prefix; a probe query for a restricted doc returns nothing; bucket policy scoped.
- **Skills:** RAG data governance, S3+Bedrock KB scoping. Maps to sensitive-information-disclosure.

### Lab 3 — Over-privileged AI agent (excessive agency)  *(Intermediate)*
- **Scenario:** a Bedrock Agent (or a tool-using Lambda "agent") has an execution role that can do far more than its task needs (e.g. broad `s3:*` or `dynamodb:*`), and a tool it shouldn't be able to reach.
- **Attack:** drive the agent (via prompt) to misuse a tool / touch a resource outside its job — a confused-deputy through the agent's own permissions.
- **Fix:** scope the agent execution role to exactly its needed actions/resources; remove the extra tool / action-group.
- **Grader checks:** agent execution role policy contains no wildcards on the sensitive service; the out-of-scope action is explicitly denied or absent; the agent still performs its legitimate task (positive check).
- **Skills:** agent/tool least-privilege, excessive-agency mitigation. This is also the **multi-learner-per-account pilot candidate** (IAM-namespaced, no account-level state).

### Lab 4 — Bedrock access control & model exfiltration  *(Advanced)*
- **Scenario:** the account allows unrestricted `bedrock:InvokeModel` from multiple principals; a "shadow" principal can call expensive/unapproved models and exfiltrate data through prompts.
- **Attack:** as the shadow principal, invoke a model that should be off-limits / exfiltrate via the model.
- **Fix:** IAM conditions restricting which principals invoke which models; a **VPC endpoint / `aws:SourceVpce` condition** so Bedrock calls can't originate off-network; deny unapproved model ARNs.
- **Grader checks:** IAM policy has model-scoping conditions; the shadow principal's invoke now denies; endpoint/condition present.
- **Skills:** Bedrock IAM conditions, private connectivity, data-exfil prevention.

### Lab 5 — AI detection & incident response  *(Advanced)*
- **Scenario:** the Bedrock app has no logging; an abuse pattern (prompt-injection attempts, anomalous invocation spikes) is happening invisibly.
- **Attack/Investigate:** enable visibility, then find the abuse in the logs.
- **Fix:** turn on **model-invocation logging** to CloudWatch/S3, add a CloudWatch metric filter/alarm for the abuse signal, confirm CloudTrail captures the control-plane changes.
- **Grader checks:** model-invocation logging enabled + destination configured; an alarm/metric-filter exists for the abuse pattern; the learner correctly identifies the offending principal (answer submitted / tagged).
- **Skills:** GenAI monitoring, detection engineering. Maps directly to the SCS-C03 **Detection & Incident Response** domain — the one they just split out.

---

## Sequencing & dependencies
1. **Pre-req (one-time):**
   - ✅ DONE 2026-07-03 — **Bedrock invoke unblocked, scoped to Nova Lite only.** The Sandbox-OU SCP (`p-rhz4lucu`) previously denied `bedrock:InvokeModel`; edited to a `DenyBedrockInvokeExceptNovaLite` statement (NotResource = `amazon.nova-lite-v1:0`). Verified: Nova Lite invoke works, Nova Micro still denied. Cost guard now enforced at the org level (only Nova Lite runnable). Original SCP backed up in scratchpad. Use **model id `amazon.nova-lite-v1:0`** for the graded/cheap path. Fine-tuning (`CreateModelCustomizationJob`) stays denied.
   - ⏳ TODO at Lab-1 build: confirm teardown covers Bedrock resources — provision Guardrails/etc. **via CloudFormation** so stack-delete cleans them (the aws-nuke include-list has no Bedrock types, but `CloudFormationStack` deletion does); add explicit cleanup for account-level model-invocation-logging config.
2. Build order: **Lab 1 first** (simplest, biggest "wow", best SEO hook: "Bedrock prompt injection lab"), then 3 (agent — doubles as multi-learner pilot), then 2, 4, 5.
3. Each lab reuses LAB-FACTORY.md; add the `ss:obj` step↔objective markers so the grade-aware UI lights up automatically.

## Go-to-market hooks (already have the content)
- Each lab ↔ an existing blog post (Bedrock, RAG, agents/MCP, LLM checklist) → internal-link the post to its lab, the lab landing to the post.
- `/ai-security` hub swaps its "in development" placeholder for real lab cards as they ship.
- **B2B headline:** "hands-on AI security for teams shipping Bedrock" — the single most sellable pilot hook right now.
- SEO: target "Bedrock security lab", "LLM security hands-on", "AI security certification prep (SCS-C03 GenAI)".

## Open questions for the owner
- Confirm the 5 scenarios + difficulty order, or swap/add (e.g. secrets-in-prompts, insecure-output-handling→downstream SSRF, training-data poisoning if in scope for a managed-service lab).
- Bedrock cost per lab run (model invocations) — set a per-session budget guard; pick cheap models for the graded path.
- Free vs paid: Lab 1 free (funnel) or keep the S3 lab as the only free one?
