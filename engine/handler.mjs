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
import { createHmac } from "node:crypto";

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

// ── Signed engine identity (audit #2) ────────────────────────────────────────
// The app sends X-Engine-Auth = b64url(JSON{u,p,exp}) + "." + b64url(HMAC). We
// recompute the HMAC with ENGINE_SHARED_SECRET, check expiry + that the signed
// path matches THIS request, then DERIVE the caller from the token — instead of
// trusting a verbatim X-User-Id header. Binds identity to path + a 2-min window.
const ENGINE_AUTH_PROD = Boolean(ENGINE_SHARED_SECRET); // strict mode == a secret is configured (matches the rest of the handler)
const ENGINE_AUTH_SKEW_SECONDS = 120; // tolerate engine clock up to 2 min ahead of the app
const ENGINE_AUTH_TTL_SECONDS = 120;  // must match the app; used to reject absurd-future exp

// Boot-assert (audit #2): a real Lambda deploy must NOT run with engine auth
// silently disabled. Local dev (no AWS_LAMBDA_FUNCTION_NAME) may run without it.
if (process.env.AWS_LAMBDA_FUNCTION_NAME && !ENGINE_SHARED_SECRET) {
  throw new Error("ENGINE_SHARED_SECRET is not configured — refusing to start with engine auth disabled");
}

function b64urlToString(s) {
  try { return Buffer.from(s, "base64url").toString("utf8"); } catch { return ""; }
}

/**
 * Verify the app-signed identity token. Returns the caller's userId on success,
 * or null on any failure. HMAC is checked BEFORE the JSON is parsed.
 */
function verifyEngineAuth(event) {
  if (!ENGINE_SHARED_SECRET) return null; // no secret -> this path isn't trusted
  const h = event.headers ?? {};
  const token = h["x-engine-auth"] ?? h["X-Engine-Auth"] ?? "";
  if (!token || typeof token !== "string") return null;

  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const head = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", ENGINE_SHARED_SECRET).update(head).digest("base64url");
  if (!timingSafeEqual(expected, sig)) return null; // verify BEFORE parse

  let claims;
  try { claims = JSON.parse(b64urlToString(head)); } catch { return null; }
  if (!claims || typeof claims !== "object") return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number") return null;
  if (claims.exp + ENGINE_AUTH_SKEW_SECONDS < now) return null;                          // expired
  if (claims.exp > now + ENGINE_AUTH_TTL_SECONDS + ENGINE_AUTH_SKEW_SECONDS) return null; // reject absurd-future exp

  const reqPath = event.rawPath ?? event.path ?? "/";
  if (claims.p !== reqPath) return null; // path binding

  return (typeof claims.u === "string" && claims.u) ? claims.u : null;
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
  reserveLaunch,
  rollbackLaunch,
  recordCompletion,
  listCompletions,
  getCompletionByCredential,
  PAYPERLAB_MAX_LAUNCHES,
  PAYPERLAB_BACKSTOP_DAYS,
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
        // #23: bound the per-run fan-out. The account's TOTAL Lambda concurrency limit
        // is only 10 (new-account default), shared by HTTP + every worker. A teardown
        // worker holds a slot for minutes (aws-nuke), so an expiry wave that dispatched
        // many at once would throttle the HTTP launch/console path. Cap at 4 (ample for
        // the 3-account pool); the rest is caught next reap tick (~3min) and the atomic
        // teardown claim makes a re-dispatch safe. ⚠️ Raise this only after the Lambda
        // concurrency limit is raised alongside the pool.
        const MAX_TEARDOWN_DISPATCH = 4;
        const batch = expired.slice(0, MAX_TEARDOWN_DISPATCH);
        for (const sessionId of batch) {
          await invokeWorker("teardown", { sessionId }).catch((e) =>
            console.error(`[reap] dispatch teardown ${sessionId} failed: ${e.message}`)
          );
        }
        const deferred = expired.length - batch.length;
        if (deferred > 0) console.log(`[reap] deferred ${deferred} teardown(s) to next tick (fan-out cap ${MAX_TEARDOWN_DISPATCH})`);
        metric({ Reaped: batch.length });
        console.log(
          `[worker] reap: checked ${activeChecked}, expired ${expired.length}, dispatched ${batch.length}` +
            (batch.length ? ` (${batch.join(", ")})` : "")
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

  // Caller identity. Prefer the app-signed, path-bound token (audit #2): it proves
  // the app asserted THIS user for THIS path within ~2 min. When present and valid
  // we DERIVE the caller from it and IGNORE the raw (spoofable) X-User-Id header.
  const signedUserId = verifyEngineAuth(event);
  let callerUserId;
  if (signedUserId) {
    callerUserId = signedUserId;
  } else if (ENGINE_AUTH_PROD) {
    // Prod with no valid signed token: do NOT fall back to X-User-Id. Treat as
    // unidentified — every ownership/identity site below fails closed on a null
    // caller, so impersonation via a forged/absent token is closed.
    callerUserId = null;
  } else {
    // Local dev (no secret): keep the legacy plaintext-header path so the local
    // engine + smoke flows work without signing.
    callerUserId = event.headers?.["x-user-id"] ?? event.headers?.["X-User-Id"] ?? null;
  }

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
      // Caller identity for the launch. In PROD use ONLY the signed caller — never a
      // body-supplied userId (audit#2 FLAW B: a leaked secret could otherwise launch
      // AS another user). Local dev keeps the body fallback for unauthenticated smoke
      // flows; "anon" is the final fallback so /health-style smoke still works.
      const uid = ENGINE_AUTH_PROD ? (callerUserId || "anon") : (callerUserId || userId || "anon");

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

      // Per-level launch limit — FREE labs only. The free lab is a lead magnet
      // (FREE_RULE = 2 runs / 24h) and needs a rolling abuse cap. PAID labs are no
      // longer capped here: their launch budget lives on the entitlement row and
      // is enforced by the app (it calls reserveLaunch — an atomic CAS on the
      // ShieldSyncLabEntitlements row — BEFORE this /launch). Applying the old
      // 2/48h level cap to paid labs would silently override the pay-per-lab
      // budget (30 launches / 7-day window). Session length still comes from the
      // per-level rule regardless; the one-live-session lock + per-IP rate cap
      // remain the engine-side backstops for paid launches.
      if (rules.free) {
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
        // MUST await — a fire-and-forget invoke leaves a floating promise when the
        // handler returns, which the Lambda runtime reports as
        // "Runtime.NodeJsExit: a Promise that was never settled" on the NEXT
        // invocation that reuses the frozen container (and stalls the warmer/reaper
        // heartbeats → false WarmerStalled/ReaperStalled alarms). Awaiting only the
        // async-dispatch (Event invoke) is fast; the warm work runs separately.
        await invokeWorker("warm").catch(() => {});
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
        return resp(404, { error: "not found" });
      }
      if (s.status !== "active") return resp(409, { error: "not ready", status: s.status });
      // Size the console session to the lab's remaining time so 60/120-min labs
      // don't lose their console after a fixed 30 min. STS role-chained creds cap
      // at 1h (ShieldSyncLabUser MaxSessionDuration), so clamp to [15min, 1h];
      // for longer labs the learner re-mints via "Copy URL for incognito".
      const remainingMs = s.expiresAt ? new Date(s.expiresAt).getTime() - Date.now() : 0;
      const durationSeconds = Math.max(900, Math.min(3600, Math.floor(remainingMs / 1000)));
      const url = await mintConsoleUrl({ accountId: s.accountId, labSlug: s.labSlug, durationSeconds });
      return resp(200, { consoleUrl: url.consoleUrl, expiresInSeconds: url.expiresInSeconds });
    }

    if (method === "POST" && path === "/teardown") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      if ((ENGINE_SHARED_SECRET && !callerUserId) || (s.userId && s.userId !== callerUserId)) {
        return resp(404, { error: "not found" });
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
      const { orderId, paymentId, amountMinor, currency } = parsed;
      const order = await getOrder(orderId);
      if (!order) return resp(404, { error: "order not found" });
      // #8 + audit#2 FLAW A: re-validate the payment against the PERSISTED order at
      // the engine's own trust boundary. amountMinor is REQUIRED and must match —
      // omitting it must NOT skip validation (that was a self-grant path for a
      // leaked-secret holder; Number(undefined) is NaN, which never equals). currency
      // is checked only when the provider supplies one: Paytm's /v3/order/status
      // response body has NO `currency` field, so confirm/callback forward undefined —
      // a strict !== here rejected every real payment (charged, no access). Relaxing
      // it loses nothing: a forger holding the worker secret would just send "INR";
      // the amount check is the real gate.
      if (Number(amountMinor) !== order.amountMinor || (currency != null && currency !== order.currency)) {
        console.warn(`[orders/paid] amount/currency mismatch or missing on ${orderId}`);
        return resp(400, { error: "amount mismatch" });
      }
      // #7: GRANT first (idempotent upsert), THEN record paid. A grant failure leaves
      // the order unpaid so the provider retries (no "charged, no access"). The grant is
      // derived from the STORED order — never a client-supplied userId/labSlug/window.
      const isMonthly = order.plan === "monthly";
      if (isMonthly) {
        // Monthly = unlimited launches for 30 days (one-time pass; a real recurring
        // subscription is a later, separate model). LIFETIME-shaped: no launch budget,
        // gated only by accessUntil.
        const accessUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        await grantEntitlement(order.userId, { labSlug: "*", kind: "monthly", accessUntil });
      } else {
        // Pay-per-lab v2: a launch budget (PAYPERLAB_MAX_LAUNCHES) within a 7-day
        // window that starts on FIRST launch (reserveLaunch stamps it). accessUntil
        // is a generous backstop so an UNUSED purchase doesn't live forever; the real
        // cap is maxLaunches + the on-first-launch window. Budget fields are written
        // idempotently (if_not_exists) so a webhook retry can't refill a used budget.
        const accessUntil = new Date(Date.now() + PAYPERLAB_BACKSTOP_DAYS * 24 * 3600 * 1000).toISOString();
        await grantEntitlement(order.userId, {
          labSlug: order.labSlug ?? "",
          kind: "per-lab",
          accessUntil,
          type: "PAY_PER_LAB",
          maxLaunches: PAYPERLAB_MAX_LAUNCHES,
          orderId,
        });
      }
      const transitioned = await markOrderPaid(orderId, paymentId);
      return resp(200, { transitioned, granted: true });
    }

    if (method === "POST" && path === "/grade") {
      const { sessionId } = parsed;
      const s = await getSession(sessionId);
      if (!s) return resp(404, { error: "not found" });
      if ((ENGINE_SHARED_SECRET && !callerUserId) || (s.userId && s.userId !== callerUserId)) {
        return resp(404, { error: "not found" });
      }
      if (s.status !== "active") return resp(409, { error: "not ready", status: s.status });
      try {
        const execRoleArn = `arn:aws:iam::${s.accountId}:role/ShieldSyncLabExec`;
        const result = await gradeLab(s.labSlug, execRoleArn, s.accountId);
        console.log(`[grade] ${sessionId} ${s.labSlug}: ${result.criteria.filter((c) => c.passed).length}/${result.criteria.length}`);
        // F2: fire-and-forget completion record — never blocks/breaks the grade response.
        if (result.passed) {
          try { await recordCompletion(callerUserId, s.labSlug); } catch (e) { console.error("recordCompletion failed", e); }
        }
        return resp(200, result);
      } catch (e) {
        console.error(`[grade] ${sessionId} failed: ${e.message}`);
        return resp(500, { error: "grading failed" });
      }
    }

    // ── Entitlements (persistent, DynamoDB-backed) ───────────────────────────
    if (method === "POST" && path === "/entitlements") {
      const { userId, labSlug, kind, accessUntil, type, maxLaunches, orderId } = parsed;
      if (!userId || !labSlug) return resp(400, { error: "userId and labSlug required" });
      // audit#2 FLAW B: a signed caller may only grant to ITSELF, so a leaked secret
      // can't POST an entitlement for an arbitrary userId. The post-payment grant
      // path is the engine's own /orders/paid (derives the grant from the stored
      // order); this route is only a same-user fallback.
      if (ENGINE_AUTH_PROD && callerUserId && callerUserId !== userId) {
        return resp(403, { error: "forbidden" });
      }
      await grantEntitlement(userId, { labSlug, kind, accessUntil, type, maxLaunches, orderId });
      return resp(200, { ok: true });
    }

    // Pay-per-lab v2: atomically reserve one launch against the caller's own
    // entitlement (CAS on version + launch budget + 7-day window). The app calls
    // this BEFORE /launch for PAY_PER_LAB labs; 409 = lost race / cap / expired.
    if (method === "POST" && path === "/entitlements/reserve-launch") {
      const { userId, labSlug, expectedVersion } = parsed;
      const uid = ENGINE_AUTH_PROD ? callerUserId : (callerUserId || userId);
      if (!uid) return resp(401, { error: "unauthorized" });
      if (ENGINE_AUTH_PROD && userId && userId !== uid) return resp(403, { error: "forbidden" });
      if (typeof labSlug !== "string" || !labSlug) return resp(400, { error: "labSlug required" });
      const r = await reserveLaunch(uid, labSlug, expectedVersion);
      if (!r.ok) return resp(409, { error: r.code });
      return resp(200, { launchesRemaining: r.launchesRemaining, windowExpiresAt: r.windowExpiresAt });
    }

    // Pay-per-lab v2: compensating decrement when a reserved launch's provision
    // fails downstream — so a 503/engine error doesn't burn a paid launch.
    if (method === "POST" && path === "/entitlements/rollback-launch") {
      const { userId, labSlug } = parsed;
      const uid = ENGINE_AUTH_PROD ? callerUserId : (callerUserId || userId);
      if (!uid) return resp(401, { error: "unauthorized" });
      if (ENGINE_AUTH_PROD && userId && userId !== uid) return resp(403, { error: "forbidden" });
      if (typeof labSlug !== "string" || !labSlug) return resp(400, { error: "labSlug required" });
      await rollbackLaunch(uid, labSlug);
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

    // F2: server-side lab completion tracking — mirrors GET /entitlements' auth shape.
    if (method === "GET" && path === "/completions") {
      const userId = ENGINE_SHARED_SECRET ? callerUserId : (callerUserId || event.queryStringParameters?.userId || null);
      if (!userId) return resp(ENGINE_SHARED_SECRET ? 401 : 400, { error: ENGINE_SHARED_SECRET ? "unauthorized" : "userId required" });
      const completions = await listCompletions(userId);
      return resp(200, { completions });
    }

    // F3: public credential verification — the /verify/<id> page resolves an id
    // to {name, labSlug, firstCompletedAt} here, via the app's server (never
    // called directly from the browser). Token-guarded like every other engine
    // route (X-Engine-Token), but intentionally NOT identity-scoped — anyone
    // holding a credential id (it's meant to be shared, e.g. on LinkedIn) can
    // verify it; the id itself is an unguessable HMAC, not a secret to protect.
    if (method === "GET" && path === "/completions/by-credential") {
      const id = event.queryStringParameters?.id;
      if (typeof id !== "string" || !/^SS-[A-Z0-9]{1,10}-[0-9a-f]{6}$/.test(id)) {
        return resp(400, { error: "invalid credential id" });
      }
      const credential = await getCompletionByCredential(id);
      if (!credential) return resp(404, { error: "not found" });
      return resp(200, { credential });
    }

    return resp(404, { error: "not found" });
  } catch (e) {
    metric({ EngineError: 1 }, { Path: path }); // handled 500s → alarm (Lambda's own Errors metric misses these)
    console.error("engine error:", e);
    return resp(500, { error: e.message });
  }
}
