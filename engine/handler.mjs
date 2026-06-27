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

// Shared-secret guard for the public HTTP surface (set via Lambda env). The app
// (labs.shieldsyncsecurity.com on Cloudflare) sends this in the X-Engine-Token
// header; without it the engine refuses non-health requests. Worker invocations
// (event._worker=true) come from Lambda InvokeCommand and bypass the HTTP layer,
// so they don't need it. Empty string in local dev = guard disabled.
const ENGINE_SHARED_SECRET = process.env.ENGINE_SHARED_SECRET || "";

// Constant-time string compare so a missing header / wrong token can't be
// length-distinguished from a correct one.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
  findExpiredSessions,
  rulesFor,
  launchCount,
  nextLaunchAt,
  freeCapacity,
  recordRating,
  ratingsSummary,
  poolCounts,
  healPool,
  hashIp,
  ipLaunchCount,
  freeIpCount,
  createOrder,
  getOrder,
  markOrderPaid,
  acquireUserLock,
  bindLockSession,
  releaseUserLock,
  enqueueWaiter,
  queuePosition,
  dequeueWaiter,
} from "./labinfra.mjs";
import { gradeLab } from "./graders.mjs";
import { metric } from "./metrics.mjs";

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
      const { sessionId, accountId, execRoleArn, labSlug, userId } = event;
      const t0 = Date.now();
      try {
        await deployLab({ sessionId, accountId, execRoleArn, labSlug });
        metric({ Deploy: 1, ColdDeploySeconds: (Date.now() - t0) / 1000 }, { Outcome: "success" });
        console.log(`[worker] deploy done ${sessionId}`);
      } catch (e) {
        metric({ Deploy: 1 }, { Outcome: "failed" });
        console.error(`[worker] deploy failed ${sessionId}: ${e.message}`);
        await markSession(sessionId, "error", e.message).catch(() => {});
        // Release the account back to the pool — deploy failed before anything
        // was provisioned, so there is nothing to nuke — and free the user's
        // launch lock so they can retry (H3).
        await releaseAccount(accountId).catch(() => {});
        await releaseUserLock(userId).catch(() => {});
      }
      await invokeWorker("warm").catch(() => {});
      return;
    }

    if (action === "teardown") {
      const { sessionId } = event;
      const t0 = Date.now();
      try {
        await teardown(sessionId);
        metric({ Teardown: 1, TeardownSeconds: (Date.now() - t0) / 1000 }, { Outcome: "success" });
        console.log(`[worker] teardown done ${sessionId}`);
      } catch (e) {
        metric({ Teardown: 1 }, { Outcome: "failed" });
        console.error(`[worker] teardown failed ${sessionId}: ${e.message}`);
      }
      await invokeWorker("warm").catch(() => {});
      return;
    }

    if (action === "warm") {
      metric({ WarmRun: 1 }); // cron heartbeat — alarm if this stops
      await runWarmer();
      await poolCounts().then((p) => metric({ PoolAvailable: p.available, PoolLeased: p.leased, PoolStuck: p.stuck })).catch(() => {});
      return;
    }

    if (action === "reap") {
      // Scheduled sweep (EventBridge): tear down expired active/leasing sessions
      // that were abandoned (sign-out / tab-close never called /end-lab). This is
      // what keeps the pool from drifting (DDB says available while AWS still holds
      // a CREATE_COMPLETE stack) and causing CREATE_FAILED collisions on next launch.
      metric({ ReapRun: 1 }); // cron heartbeat — alarm if this stops
      try {
        // Identify expired sessions, then DISPATCH one async teardown worker each so
        // the accounts recycle CONCURRENTLY (own Lambda container per account, own
        // 15-min budget) instead of nuking serially in this single invocation. A
        // wave of expiries now recovers the pool in ~1x nuke time, not Nx — and no
        // single reap can time out mid-nuke and strand later accounts.
        const { activeChecked, expired } = await findExpiredSessions();
        for (const sessionId of expired) {
          await invokeWorker("teardown", { sessionId }).catch((e) =>
            console.error(`[reap] dispatch teardown ${sessionId} failed: ${e.message}`)
          );
        }
        metric({ Reaped: expired.length });
        console.log(
          `[worker] reap: checked ${activeChecked}, expired ${expired.length}, dispatched ${expired.length}` +
            (expired.length ? ` (${expired.join(", ")})` : "")
        );
      } catch (e) {
        console.error(`[worker] reap failed: ${e.message}`);
      }
      // Self-heal drifted accounts (leaked-after-settle / hung deploy) before we
      // census — so the gauge reflects the post-heal truth.
      try {
        const h = await healPool();
        metric({ Healed: h.healed.length });
        if (h.healed.length) console.log(`[worker] heal: reclaimed ${h.healed.length} (${h.healed.join(", ")})`);
      } catch (e) {
        console.error(`[worker] heal failed: ${e.message}`);
      }
      // Pool census every reap (~3 min) → drives the PoolAvailable=0 starvation
      // alarm and the PoolStuck (drifted account) alarm.
      await poolCounts().then((p) => metric({ PoolAvailable: p.available, PoolLeased: p.leased, PoolStuck: p.stuck })).catch(() => {});
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

  // Shared-secret check (skipped for /health and when no secret is configured,
  // i.e. local dev). API GW header names arrive lower-cased on v2 events.
  if (ENGINE_SHARED_SECRET && !(method === "GET" && path === "/health")) {
    const h = event.headers ?? {};
    const supplied = h["x-engine-token"] ?? h["X-Engine-Token"] ?? "";
    if (!timingSafeEqual(supplied, ENGINE_SHARED_SECRET)) {
      return resp(401, { error: "unauthorized" });
    }
  }

  // Trusted caller identity from the app. The app puts this in X-User-Id from
  // its Cognito session; the engine uses it for ownership checks below.
  const callerUserId =
    event.headers?.["x-user-id"] ?? event.headers?.["X-User-Id"] ?? null;

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
      // Reject path-traversal-shaped labSlugs at the API edge before leasing.
      // Without this, a bogus slug consumes a pool account and a rate-limit slot
      // before the deploy step rejects it (deployStack also validates — this is
      // defense in depth).
      if (typeof labSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(labSlug)) {
        return resp(400, { error: "invalid lab slug" });
      }
      // Trust the header (set by the app from the verified Cognito session) over
      // the body when both are present; falls back to body for local-dev callers
      // without auth, and finally to "anon" so the smoke /health flow still works.
      const uid = callerUserId || userId || "anon";

      // Abuse guard: per-network rate cap (Cloudflare client IP, hashed). Bounds
      // burst farming from one IP across labs/accounts before we do any real work.
      const ipHash = hashIp(event.headers?.["x-client-ip"] ?? event.headers?.["X-Client-IP"] ?? null);
      if (ipHash && (await ipLaunchCount(ipHash, 10)) >= 8) {
        metric({ Launch: 1 }, { Outcome: "ratelimited" });
        console.log(`[launch] RATE_LIMITED ip-hash ${ipHash.slice(0, 8)}… (>=8 launches/10min)`);
        return resp(429, { error: "RATE_LIMITED" });
      }

      const existing = await findActiveSession(uid, labSlug);
      if (existing) {
        await dequeueWaiter(uid).catch(() => {}); // they have a seat — leave the line
        console.log(`[launch] reconnect ${existing.sessionId} (${labSlug})`);
        return resp(200, { sessionId: existing.sessionId, expiresAt: existing.expiresAt, resumed: true });
      }

      const rules = rulesFor(labSlug);

      // H3: atomically claim the per-user launch lock BEFORE leasing — closes the
      // TOCTOU window where two concurrent launches could each grab an account.
      // ttl = session window + 10 min grace (DynamoDB TTL is the backstop).
      const lock = await acquireUserLock(uid, labSlug, rules.sessionMinutes * 60 + 600);
      if (!lock.acquired) {
        // Lost the race, or the user already has a live lab. If it's the SAME lab,
        // the winner's session row likely exists by now → reconnect; otherwise
        // tell them which lab they already have running.
        const raced = await findActiveSession(uid, labSlug);
        if (raced) {
          await dequeueWaiter(uid).catch(() => {}); // they have a seat — leave the line
          console.log(`[launch] reconnect-after-lock ${raced.sessionId} (${labSlug})`);
          return resp(200, { sessionId: raced.sessionId, expiresAt: raced.expiresAt, resumed: true });
        }
        console.log(`[launch] ALREADY_ACTIVE ${uid} wants ${labSlug}, holds ${lock.labSlug}`);
        return resp(409, { error: "ALREADY_ACTIVE", labSlug: lock.labSlug });
      }

      // Per-level launch limit (e.g. Beginner = 3 runs / 72h). Reconnects don't
      // count — only genuinely new runs do. Session length is also per-level.
      const used = await launchCount(uid, labSlug, rules.windowHours);
      if (used >= rules.maxLaunches) {
        await releaseUserLock(uid);
        console.log(`[launch] LIMIT_REACHED ${uid} ${labSlug}: ${used}/${rules.maxLaunches} in ${rules.windowHours}h`);
        metric({ Launch: 1 }, { Outcome: "limit" });
        // Exact time the next run frees up (oldest in-window launch + window) so the
        // UI can show "unlocks at 3:45 PM" instead of a vague "about 24h".
        const retryAt = await nextLaunchAt(uid, labSlug, rules.windowHours, rules.maxLaunches).catch(() => null);
        return resp(429, {
          error: "LIMIT_REACHED",
          maxLaunches: rules.maxLaunches,
          windowHours: rules.windowHours,
          used,
          retryAt,
        });
      }

      // Free labs are capped to a share of the pool (FREE_POOL_PCT) so a free rush
      // can't starve paying users — paid launches skip this and use the rest.
      if (rules.free) {
        // Multi-account guard: cap FREE launches per network (defeats "many Google
        // accounts, one IP" farming of the per-user 1/24h free cap). The IP window
        // stays 48h (broader abuse net) even though the per-user cooldown is 24h.
        if (ipHash && (await freeIpCount(ipHash, 48)) >= 3) {
          await releaseUserLock(uid);
          metric({ Launch: 1 }, { Outcome: "freeip" });
          console.log(`[launch] FREE_IP_LIMIT ip-hash ${ipHash.slice(0, 8)}… (>=3 free/48h)`);
          return resp(429, { error: "FREE_IP_LIMIT" });
        }
        const fc = await freeCapacity();
        if (fc.reached) {
          await releaseUserLock(uid);
          // Join the wait-room line (informational) and report this user's place.
          await enqueueWaiter(uid, labSlug).catch(() => {});
          const q = await queuePosition(uid, labSlug).catch(() => ({ position: 1, waiting: 1 }));
          metric({ Launch: 1 }, { Outcome: "freebusy" });
          console.log(`[launch] FREE_AT_CAPACITY ${fc.busy}/${fc.cap} (pool ${fc.total}) nextFreeAt=${fc.nextFreeAt} pos=${q.position}/${q.waiting}`);
          return resp(503, { error: "FREE_AT_CAPACITY", freeCap: fc.cap, freeBusy: fc.busy, poolSize: fc.total, nextFreeAt: fc.nextFreeAt, position: q.position, waiting: q.waiting });
        }
      }

      let leased;
      try {
        leased = await lease(uid, labSlug, rules.sessionMinutes, ipHash);
      } catch (e) {
        await releaseUserLock(uid);
        if (e.message === "NO_CAPACITY") { metric({ Launch: 1 }, { Outcome: "nocapacity" }); return resp(503, { error: "NO_CAPACITY" }); }
        throw e;
      }

      await bindLockSession(uid, leased.sessionId);
      await dequeueWaiter(uid).catch(() => {}); // got a seat — leave the line
      metric({ Launch: 1 }, { Outcome: leased.warm ? "warm" : "cold" });

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
          userId: uid,
        });
      }

      return resp(200, { sessionId: leased.sessionId, expiresAt: leased.expiresAt, resumed: false, warm: leased.warm });
    }

    if (method === "GET" && path === "/active") {
      // Server-authoritative: does THIS user already have a live session for this
      // lab? Lets ANY tab/device restore the running lab — not just the tab that
      // launched it (closes the sessionStorage-only per-tab gap).
      const labSlug = event.queryStringParameters?.labSlug;
      // Prod: require an identified caller; never fall back to a shared "anon"
      // bucket (an unauthenticated caller must not see anyone's live session).
      if (ENGINE_SHARED_SECRET && !callerUserId) return resp(200, { session: null });
      const s = await findActiveSession(callerUserId || "anon", labSlug);
      return resp(200, { session: s });
    }

    if (method === "GET" && path === "/queue") {
      // Wait-room poll: refresh this user's place in line, report it, and say
      // whether a free seat has opened (so the client can launch immediately
      // instead of waiting out the countdown). Informational only — see
      // enqueueWaiter() in labinfra. Free labs only.
      const labSlug = event.queryStringParameters?.labSlug;
      if (typeof labSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(labSlug)) {
        return resp(400, { error: "invalid lab slug" });
      }
      const uid = callerUserId || "anon";
      const fc = await freeCapacity();
      if (!fc.reached) {
        // A seat is free — drop them from the line; the client should launch now.
        await dequeueWaiter(uid).catch(() => {});
        return resp(200, { reached: false, nextFreeAt: fc.nextFreeAt, position: 0, waiting: 0 });
      }
      await enqueueWaiter(uid, labSlug).catch(() => {});
      const q = await queuePosition(uid, labSlug).catch(() => ({ position: 1, waiting: 1 }));
      return resp(200, { reached: true, nextFreeAt: fc.nextFreeAt, position: q.position, waiting: q.waiting });
    }

    if (method === "GET" && path.startsWith("/session/")) {
      const id = path.slice("/session/".length);
      const s = await getSession(id);
      if (!s) return resp(404, { error: "not found" });
      // Ownership: when the caller is identified, only return THEIR session.
      // (Anonymous local-dev callers see anything, matching prior behaviour.)
      if ((ENGINE_SHARED_SECRET && !callerUserId) || (s.userId && s.userId !== callerUserId)) {
        return resp(404, { error: "not found" });
      }
      return resp(200, s);
    }

    if (method === "POST" && path === "/console") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      if ((ENGINE_SHARED_SECRET && !callerUserId) || (s.userId && s.userId !== callerUserId)) {
        return resp(403, { error: "forbidden" });
      }
      if (s.status !== "active") return resp(409, { error: "not ready", status: s.status });
      // Size the console session to the lab's remaining time so 60/120-min labs
      // don't lose their console after a fixed 30 min. STS role-chained creds cap
      // at 1h (ShieldSyncLabUser MaxSessionDuration), so clamp to [15min, 1h];
      // for longer labs the learner re-mints via "Copy URL for incognito".
      const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : 0;
      const durationSeconds = Math.max(900, Math.min(3600, Math.floor(remainingMs / 1000)));
      const url = await mintConsoleUrl({ accountId: s.accountId, durationSeconds });
      return resp(200, { consoleUrl: url.consoleUrl, expiresInSeconds: url.expiresInSeconds });
    }

    if (method === "POST" && path === "/teardown") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      if ((ENGINE_SHARED_SECRET && !callerUserId) || (s.userId && s.userId !== callerUserId)) {
        return resp(403, { error: "forbidden" });
      }
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

    if (method === "GET" && path === "/ratings/summary") {
      // Aggregated 👍/👎 per lab for the admin readout. Admin-gating happens in the
      // app (only admins can reach /api/admin/ratings); the token guards the engine.
      return resp(200, { labs: await ratingsSummary() });
    }

    // ── Payment orders (runbook §6d) — token-guarded; the app's /checkout +
    // /webhook are the only callers. The webhook validates a provider payment vs
    // the persisted order, then grants on the idempotent created->paid transition.
    if (method === "POST" && path === "/orders") {
      const order = parsed;
      if (!order?.id || !order?.userId) return resp(400, { error: "order id + userId required" });
      await createOrder(order);
      return resp(200, { ok: true });
    }

    if (method === "GET" && path === "/orders") {
      const order = await getOrder(event.queryStringParameters?.orderId);
      return resp(200, { order });
    }

    if (method === "POST" && path === "/orders/paid") {
      const { orderId, paymentId } = parsed;
      const transitioned = await markOrderPaid(orderId, paymentId);
      return resp(200, { transitioned });
    }

    if (method === "POST" && path === "/grade") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      if ((ENGINE_SHARED_SECRET && !callerUserId) || (s.userId && s.userId !== callerUserId)) {
        return resp(403, { error: "forbidden" });
      }
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
      // Prod: serve ONLY the authenticated caller's entitlements — never a
      // client-supplied ?userId (that allowed reading anyone's purchases).
      const userId = ENGINE_SHARED_SECRET ? callerUserId : (callerUserId || event.queryStringParameters?.userId || null);
      if (!userId) return resp(ENGINE_SHARED_SECRET ? 401 : 400, { error: ENGINE_SHARED_SECRET ? "unauthorized" : "userId required" });
      const items = await listEntitlements(userId);
      return resp(200, { entitlements: items });
    }

    return resp(404, { error: "not found" });
  } catch (e) {
    metric({ EngineError: 1 }, { Path: path }); // handled 500s → alarm (Lambda's own Errors metric misses these)
    console.error("engine error:", e);
    return resp(500, { error: e.message });
  }
}
