// ShieldSync Labs — Lambda handler (production engine).
// Replaces server.mjs. Runs in the platform account (750294427884) as
// ShieldSyncEngineRole — no credential bridge needed.
//
// Long-running work (deploy, teardown, warm) is kicked off by invoking THIS
// function asynchronously with {_worker:true, action:...} so the HTTP response
// is returned immediately and the heavy work completes in its own invocation.

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  lease,
  deployLab,
  mintConsoleUrl,
  teardown,
  findActiveSession,
  getSession,
  markSession,
  ensureWarm,
  upsertUser,
} from "./labinfra.mjs";

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

    if (action === "deploy") {
      const { sessionId, accountId, execRoleArn, labSlug } = event;
      try {
        await deployLab({ sessionId, accountId, execRoleArn, labSlug });
        console.log(`[worker] deploy done ${sessionId}`);
      } catch (e) {
        console.error(`[worker] deploy failed ${sessionId}: ${e.message}`);
        await markSession(sessionId, "error", e.message).catch(() => {});
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

      let leased;
      try {
        leased = await lease(uid, labSlug);
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

    return resp(404, { error: "not found" });
  } catch (e) {
    console.error("engine error:", e);
    return resp(500, { error: e.message });
  }
}
