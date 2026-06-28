// ShieldSync Labs — Session Engine HTTP server (local dev).
// ASYNC + PRE-WARMED: launch/teardown return immediately; deploy/nuke run in the
// background; a warmer keeps idle accounts pre-deployed so a lease is INSTANT;
// the UI polls GET /session/:id for the truth; console URLs are minted fresh.
// In production this becomes a Lambda + a worker; the app calls it the same way.
//
// Run: node server.mjs   (listens on :4000)

import { createServer } from "node:http";
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
  reap,
} from "./labinfra.mjs";

const PORT = Number(process.env.ENGINE_PORT || 4000);
const PRIMARY_LAB = "s3-misconfiguration-audit"; // kept pre-warmed for instant start

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let s = "";
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
}

// Background warmer — keeps every idle account pre-deployed with PRIMARY_LAB.
let warmingNow = false;
async function runWarmer() {
  if (warmingNow) return;
  warmingNow = true;
  try {
    const w = await ensureWarm(PRIMARY_LAB);
    if (w.length) console.log(`[warm] pre-warmed ${w.length} account(s) with ${PRIMARY_LAB}`);
  } catch (e) {
    console.error("[warm] error:", e.message);
  } finally {
    warmingNow = false;
  }
}

// Background reaper — auto-teardown sessions whose window has expired. This is
// the server-side safety net for learners who close the tab without clicking
// End. WITHOUT it, abandoned sessions (and their stacks) leak and clog the
// per-account resource names, so every later launch collides ("already exists").
let reapingNow = false;
async function runReaper() {
  if (reapingNow) return;
  reapingNow = true;
  try {
    const reaped = await reap();
    if (reaped.length) {
      console.log(`[reap] tore down ${reaped.length} expired session(s): ${reaped.join(", ")}`);
      runWarmer(); // freed accounts -> top the warm pool back up
    }
  } catch (e) {
    console.error("[reap] error:", e.message);
  } finally {
    reapingNow = false;
  }
}

const server = createServer(async (req, res) => {
  try {
    const path = (req.url || "").split("?")[0];

    if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });

    // POST /launch — instant lease (warm = ready now; cold = deploy in background)
    if (req.method === "POST" && path === "/launch") {
      const { userId, labSlug } = await readBody(req);
      const uid = userId || "anon";

      const existing = await findActiveSession(uid);
      if (existing) {
        console.log(`[launch] reconnect ${existing.sessionId} (${existing.accountId})`);
        return send(res, 200, { sessionId: existing.sessionId, expiresAt: existing.expiresAt, resumed: true });
      }

      let leased;
      try {
        leased = await lease(uid, labSlug);
      } catch (e) {
        if (e.message === "NO_CAPACITY") return send(res, 503, { error: "NO_CAPACITY" });
        throw e;
      }

      send(res, 200, { sessionId: leased.sessionId, expiresAt: leased.expiresAt, resumed: false, warm: leased.warm });

      if (leased.warm) {
        console.log(`[launch] WARM hit ${leased.sessionId} on ${leased.accountId} — instant`);
        runWarmer(); // a warm account was consumed -> top the pool back up
        return;
      }

      console.log(`[launch] cold lease ${leased.sessionId} on ${leased.accountId} — deploying in background`);
      deployLab({ ...leased, labSlug })
        .then(() => console.log(`[launch] ready ${leased.sessionId}`))
        .catch(async (e) => {
          console.error(`[launch] deploy FAILED ${leased.sessionId}: ${e.message}`);
          await markSession(leased.sessionId, "error", e.message).catch(() => {});
          teardown(leased.sessionId).catch((te) => console.error(`[launch] cleanup failed: ${te.message}`));
        });
      return;
    }

    // GET /session/:id — the status truth the UI polls.
    if (req.method === "GET" && path.startsWith("/session/")) {
      const id = path.slice("/session/".length);
      const s = await getSession(id);
      if (!s) return send(res, 404, { error: "not found" });
      return send(res, 200, s);
    }

    // POST /console — mint a FRESH console URL on demand (only when ready).
    if (req.method === "POST" && path === "/console") {
      const { sessionId } = await readBody(req);
      const s = await getSession(sessionId);
      if (!s) return send(res, 404, { error: "not found" });
      if (s.status !== "active") return send(res, 409, { error: "not ready", status: s.status });
      const url = await mintConsoleUrl({ accountId: s.accountId, labSlug: s.labSlug });
      return send(res, 200, { consoleUrl: url.consoleUrl, expiresInSeconds: url.expiresInSeconds });
    }

    // POST /teardown — flag ending, return now, nuke + re-warm in the BACKGROUND.
    if (req.method === "POST" && path === "/teardown") {
      const { sessionId } = await readBody(req);
      const s = await getSession(sessionId);
      if (!s) return send(res, 404, { error: "not found" });
      await markSession(sessionId, "ending").catch(() => {});
      console.log(`[teardown] ${sessionId} — wiping in background`);
      send(res, 200, { status: "ending" });
      teardown(sessionId)
        .then(() => runWarmer())
        .catch((e) => console.error(`[teardown] bg error ${sessionId}: ${e.message}`));
      return;
    }

    // POST /user — record a signed-in user (marketing list). Called by the app's
    // auth callback after a verified login. Best-effort; never blocks login.
    if (req.method === "POST" && path === "/user") {
      const { id, email, name, provider } = await readBody(req);
      if (!id) return send(res, 400, { error: "id required" });
      try {
        await upsertUser({ id, email, name, provider });
        return send(res, 200, { ok: true });
      } catch (e) {
        console.error(`[user] upsert failed ${id}: ${e.message}`);
        return send(res, 500, { error: e.message });
      }
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error("engine error:", e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`engine listening on http://localhost:${PORT}`);
  runWarmer(); // warm the pool on startup
  setInterval(runWarmer, 60000); // keep it topped up
  runReaper(); // sweep anything already expired on startup
  setInterval(runReaper, 60000); // and auto-teardown expired sessions every minute
});
