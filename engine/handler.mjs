// ShieldSync Labs — Lambda handler (production engine).
// Replaces server.mjs. Runs in the platform account (750294427884) as
// ShieldSyncEngineRole — no credential bridge needed.
//
// Long-running work (deploy, teardown, warm) is kicked off by invoking THIS
// function asynchronously with {_worker:true, action:...} so the HTTP response
// is returned immediately and the heavy work completes in its own invocation.
//
// aws-nuke binary: too large to bundle (287 MB). Stored in S3; downloaded to
// /tmp at container init so teardown workers have it ready.

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { chmod } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const DEPLOY_BUCKET = "shieldsync-engine-deploy-750294427884";
const NUKE_TMP      = "/tmp/aws-nuke";

// Download the binary once per Lambda container (module-level, runs at cold start).
const nukeReady = process.env.AWS_LAMBDA_FUNCTION_NAME
  ? (async () => {
      const s3 = new S3Client({ region: "us-east-1" });
      const { Body } = await s3.send(new GetObjectCommand({ Bucket: DEPLOY_BUCKET, Key: "aws-nuke-linux" }));
      const ws = createWriteStream(NUKE_TMP);
      await pipeline(Body, ws);
      await chmod(NUKE_TMP, 0o755);
      console.log("[init] aws-nuke downloaded to /tmp");
    })().catch(e => { console.error("[init] aws-nuke download failed:", e.message); throw e; })
  : Promise.resolve();
import {
  lease,
  deployLab,
  mintConsoleUrl,
  teardown,
  findActiveSession,
  getSession,
  markSession,
  releaseAccount,
  ensureWarm,
  upsertUser,
  grantEntitlement,
  listEntitlements,
  reap,
  rulesFor,
  launchCount,
  freeCapacity,
  recordRating,
} from "./labinfra.mjs";
import { gradeLab } from "./graders.mjs";

const PRIMARY_LAB = "s3-misconfiguration-audit";

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Fire a worker invocation of THIS function (non-blocking).
async function invokeWorker(action, payload = {}) {
  const lambda = new LambdaClient({ region: "us-east-1" });
  await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      InvocationType: "Event", // async — don't wait for result
      Payload: JSON.stringify({ _worker: true, action, ...payload }),
    })
  );
}

async function runWarmer() {
  try {
    const w = await ensureWarm(PRIMARY_LAB);
    if (w.length) console.log(`[warm] pre-warmed ${w.length} account(s) with ${PRIMARY_LAB}`);
  } catch (e) {
    console.error("[warm] error:", e.message);
  }
}

export async function handler(event) {
  // ── Worker path (invoked async by invokeWorker) ──────────────────────────
  if (event._worker) {
    const { action } = event;
    await nukeReady; // ensure binary is in /tmp before any work that needs it

    if (action === "deploy") {
      const { sessionId, accountId, execRoleArn, labSlug } = event;
      try {
        await deployLab({ sessionId, accountId, execRoleArn, labSlug });
        console.log(`[worker] deploy done ${sessionId}`);
      } catch (e) {
        console.error(`[worker] deploy failed ${sessionId}: ${e.message}`);
        await markSession(sessionId, "error", e.message).catch(() => {});
        // Release the account back to the pool — deploy failed before anything
        // was provisioned, so there is nothing to nuke.
        await releaseAccount(accountId).catch(() => {});
      }
      await invokeWorker("warm").catch(() => {});
      return;
    }

    if (action === "teardown") {
      const { sessionId } = event;
      try {
        await teardown(sessionId);
        console.log(`[worker] teardown done ${sessionId}`);
      } catch (e) {
        console.error(`[worker] teardown failed ${sessionId}: ${e.message}`);
      }
      await invokeWorker("warm").catch(() => {});
      return;
    }

    if (action === "warm") {
      await runWarmer();
      return;
    }

    if (action === "reap") {
      // Scheduled sweep (EventBridge): tear down expired active/leasing sessions
      // that were abandoned (sign-out / tab-close never called /end-lab). This is
      // what keeps the pool from drifting (DDB says available while AWS still holds
      // a CREATE_COMPLETE stack) and causing CREATE_FAILED collisions on next launch.
      try {
        const r = await reap();
        console.log(
          `[worker] reap: checked ${r.activeChecked}, expired ${r.expired}, reaped ${r.reaped.length}` +
            (r.reaped.length ? ` (${r.reaped.join(", ")})` : "")
        );
      } catch (e) {
        console.error(`[worker] reap failed: ${e.message}`);
      }
      return;
    }

    console.error("[worker] unknown action:", action);
    return;
  }

  // ── HTTP path (invoked via Function URL) ─────────────────────────────────
  const method = (
    event.requestContext?.http?.method ??
    event.httpMethod ??
    "GET"
  ).toUpperCase();
  const path = event.rawPath ?? event.path ?? "/";

  let parsed = {};
  try {
    if (event.body) {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString()
        : event.body;
      parsed = JSON.parse(raw);
    }
  } catch {}

  try {
    if (method === "GET" && path === "/health") {
      return resp(200, { ok: true });
    }

    if (method === "POST" && path === "/launch") {
      const { userId, labSlug } = parsed;
      const uid = userId || "anon";

      const existing = await findActiveSession(uid);
      if (existing) {
        console.log(`[launch] reconnect ${existing.sessionId}`);
        return resp(200, { sessionId: existing.sessionId, expiresAt: existing.expiresAt, resumed: true });
      }

      // Per-level launch limit (e.g. Beginner = 3 runs / 72h). Reconnects above
      // don't count — only genuinely new runs do. Session length is also per-level.
      const rules = rulesFor(labSlug);
      const used = await launchCount(uid, labSlug, rules.windowHours);
      if (used >= rules.maxLaunches) {
        console.log(`[launch] LIMIT_REACHED ${uid} ${labSlug}: ${used}/${rules.maxLaunches} in ${rules.windowHours}h`);
        return resp(429, {
          error: "LIMIT_REACHED",
          maxLaunches: rules.maxLaunches,
          windowHours: rules.windowHours,
          used,
        });
      }

      // Free labs are capped to a share of the pool (FREE_POOL_PCT) so a free rush
      // can't starve paying users — paid launches skip this and use the rest.
      if (rules.free) {
        const fc = await freeCapacity();
        if (fc.reached) {
          console.log(`[launch] FREE_AT_CAPACITY ${fc.busy}/${fc.cap} (pool ${fc.total})`);
          return resp(503, { error: "FREE_AT_CAPACITY", freeCap: fc.cap, freeBusy: fc.busy, poolSize: fc.total });
        }
      }

      let leased;
      try {
        leased = await lease(uid, labSlug, rules.sessionMinutes);
      } catch (e) {
        if (e.message === "NO_CAPACITY") return resp(503, { error: "NO_CAPACITY" });
        throw e;
      }

      if (leased.warm) {
        console.log(`[launch] WARM hit ${leased.sessionId} on ${leased.accountId}`);
        invokeWorker("warm").catch(() => {}); // top the pool back up
      } else {
        console.log(`[launch] cold ${leased.sessionId} on ${leased.accountId} — deploying async`);
        await invokeWorker("deploy", {
          sessionId: leased.sessionId,
          accountId: leased.accountId,
          execRoleArn: leased.execRoleArn,
          labSlug,
        });
      }

      return resp(200, { sessionId: leased.sessionId, expiresAt: leased.expiresAt, resumed: false, warm: leased.warm });
    }

    if (method === "GET" && path.startsWith("/session/")) {
      const id = path.slice("/session/".length);
      const s = await getSession(id);
      if (!s) return resp(404, { error: "not found" });
      return resp(200, s);
    }

    if (method === "POST" && path === "/console") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      if (s.status !== "active") return resp(409, { error: "not ready", status: s.status });
      const url = await mintConsoleUrl({ accountId: s.accountId });
      return resp(200, { consoleUrl: url.consoleUrl, expiresInSeconds: url.expiresInSeconds });
    }

    if (method === "POST" && path === "/teardown") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      await markSession(sessionId, "ending").catch(() => {});
      await invokeWorker("teardown", { sessionId });
      console.log(`[teardown] ${sessionId} — async worker launched`);
      return resp(200, { status: "ending" });
    }

    if (method === "POST" && path === "/user") {
      const { id, email, name, provider } = parsed;
      if (!id) return resp(400, { error: "id required" });
      await upsertUser({ id, email, name, provider });
      return resp(200, { ok: true });
    }

    if (method === "POST" && path === "/rate") {
      const { userId, labSlug, rating } = parsed;
      if (!userId || !labSlug || !rating) return resp(400, { error: "userId, labSlug, rating required" });
      await recordRating(userId, labSlug, rating);
      return resp(200, { ok: true });
    }

    if (method === "POST" && path === "/grade") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      if (s.status !== "active") return resp(409, { error: "not ready", status: s.status });
      try {
        const execRoleArn = `arn:aws:iam::${s.accountId}:role/ShieldSyncLabExec`;
        const result = await gradeLab(s.labSlug, execRoleArn, s.accountId);
        console.log(`[grade] ${sessionId} ${s.labSlug}: ${result.criteria.filter((c) => c.passed).length}/${result.criteria.length}`);
        return resp(200, result);
      } catch (e) {
        console.error(`[grade] ${sessionId} failed: ${e.message}`);
        return resp(500, { error: "grading failed" });
      }
    }

    // ── Entitlements (persistent, DynamoDB-backed) ───────────────────────────
    if (method === "POST" && path === "/entitlements") {
      const { userId, labSlug, kind, accessUntil } = parsed;
      if (!userId || !labSlug) return resp(400, { error: "userId and labSlug required" });
      await grantEntitlement(userId, { labSlug, kind, accessUntil });
      return resp(200, { ok: true });
    }

    if (method === "GET" && path === "/entitlements") {
      const userId = event.queryStringParameters?.userId ?? null;
      if (!userId) return resp(400, { error: "userId required" });
      const items = await listEntitlements(userId);
      return resp(200, { entitlements: items });
    }

    return resp(404, { error: "not found" });
  } catch (e) {
    console.error("engine error:", e);
    return resp(500, { error: e.message });
  }
}
