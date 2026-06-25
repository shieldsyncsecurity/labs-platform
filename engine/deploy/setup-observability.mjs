// One-shot (idempotent) setup of ShieldSync Labs observability in the platform
// account (750): an SNS alerts topic + email subscription, CloudWatch alarms on
// the EMF metrics the engine emits, and a one-glance dashboard.
//
//   node setup-observability.mjs                 # email → info@shieldsyncsecurity.com
//   ALERT_EMAIL=you@x.com node setup-observability.mjs
//
// Re-runnable: topic/alarms/dashboard are upserts; the email subscription is only
// (re)created if that address isn't already subscribed (so re-runs don't spam
// confirmation emails). After the first run, CONFIRM the subscription via the
// email AWS sends, or alarms can't notify.

import { SNSClient, CreateTopicCommand, SubscribeCommand, ListSubscriptionsByTopicCommand } from "@aws-sdk/client-sns";
import { CloudWatchClient, PutMetricAlarmCommand, PutDashboardCommand } from "@aws-sdk/client-cloudwatch";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const FN = "ShieldSyncEngine";
const NS = "ShieldSyncLabs";
const ALERT_EMAIL = process.env.ALERT_EMAIL ?? "info@shieldsyncsecurity.com";

const sts = new STSClient({ region: REGION });
const cr = (await sts.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`, RoleSessionName: "setup-observability" }))).Credentials;
const creds = { accessKeyId: cr.AccessKeyId, secretAccessKey: cr.SecretAccessKey, sessionToken: cr.SessionToken };
const sns = new SNSClient({ region: REGION, credentials: creds });
const cw = new CloudWatchClient({ region: REGION, credentials: creds });

// ── SNS topic + email subscription ─────────────────────────────────────────
const topicArn = (await sns.send(new CreateTopicCommand({ Name: "ShieldSyncLabsAlerts" }))).TopicArn;
console.log(`SNS topic: ${topicArn}`);

const subs = (await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }))).Subscriptions ?? [];
const already = subs.find((s) => s.Protocol === "email" && s.Endpoint === ALERT_EMAIL);
if (already && already.SubscriptionArn !== "PendingConfirmation") {
  console.log(`Email ${ALERT_EMAIL} already subscribed + confirmed.`);
} else if (already) {
  console.log(`Email ${ALERT_EMAIL} subscription is PENDING — confirm via the AWS email.`);
} else {
  await sns.send(new SubscribeCommand({ TopicArn: topicArn, Protocol: "email", Endpoint: ALERT_EMAIL }));
  console.log(`Subscribed ${ALERT_EMAIL} → CONFIRM the email AWS just sent (subject "AWS Notification - Subscription Confirmation").`);
}

// ── alarms ──────────────────────────────────────────────────────────────────
const alarm = (name, o) =>
  cw.send(new PutMetricAlarmCommand({
    AlarmName: name,
    AlarmDescription: o.desc,
    ActionsEnabled: true,
    AlarmActions: [topicArn],
    OKActions: [topicArn],
    Namespace: o.ns ?? NS,
    MetricName: o.metric,
    Dimensions: o.dims,
    Statistic: o.stat ?? "Sum",
    Period: o.period,
    EvaluationPeriods: o.eval,
    DatapointsToAlarm: o.dp ?? o.eval,
    Threshold: o.threshold,
    ComparisonOperator: o.op,
    TreatMissingData: o.missing ?? "notBreaching",
  }));

const GTE = "GreaterThanOrEqualToThreshold";
const LT = "LessThanThreshold";

const alarms = [
  ["ShieldSyncLabs-DeployFailed", { metric: "Deploy", dims: [{ Name: "Outcome", Value: "failed" }], op: GTE, threshold: 1, period: 300, eval: 1, desc: "A cold lab deploy failed (CREATE_FAILED / error). A user's launch broke." }],
  ["ShieldSyncLabs-TeardownFailed", { metric: "Teardown", dims: [{ Name: "Outcome", Value: "failed" }], op: GTE, threshold: 1, period: 300, eval: 1, desc: "A lab teardown (aws-nuke) failed — an account may be stranded/leaked." }],
  ["ShieldSyncLabs-EngineError", { metric: "EngineError", op: GTE, threshold: 1, period: 300, eval: 1, desc: "Engine returned a handled 500." }],
  ["ShieldSyncLabs-LambdaErrors", { ns: "AWS/Lambda", metric: "Errors", dims: [{ Name: "FunctionName", Value: FN }], op: GTE, threshold: 1, period: 300, eval: 1, desc: "Engine Lambda threw an uncaught error." }],
  // sustained problems (use Maximum so a transient 0 between reaps doesn't trip)
  ["ShieldSyncLabs-PoolStarvation", { metric: "PoolAvailable", stat: "Maximum", op: LT, threshold: 1, period: 300, eval: 3, dp: 3, desc: "Zero free accounts for ~15 min — users stuck in the wait-room. Scale the pool." }],
  ["ShieldSyncLabs-PoolStuck", { metric: "PoolStuck", stat: "Maximum", op: GTE, threshold: 1, period: 300, eval: 3, dp: 3, desc: "An account is leased with no live session (drifted/leaked) for ~15 min." }],
  // cron heartbeats — missing data = the cron stopped firing
  ["ShieldSyncLabs-ReaperStalled", { metric: "ReapRun", op: LT, threshold: 1, period: 900, eval: 1, missing: "breaching", desc: "Reaper cron hasn't run in 15 min — pool will drift and starve." }],
  ["ShieldSyncLabs-WarmerStalled", { metric: "WarmRun", op: LT, threshold: 1, period: 1800, eval: 1, missing: "breaching", desc: "Warmer cron hasn't run in 30 min — launches go slow/cold." }],
];

for (const [name, o] of alarms) {
  await alarm(name, o);
  console.log(`  alarm ✓ ${name}`);
}

// ── dashboard ───────────────────────────────────────────────────────────────
const m = (metric, opts = {}) => [NS, metric, ...(opts.dim ? [opts.dim.Name, opts.dim.Value] : []), { stat: opts.stat ?? "Sum", ...(opts.label ? { label: opts.label } : {}) }];
const body = {
  widgets: [
    { type: "metric", x: 0, y: 0, width: 12, height: 6, properties: { title: "Pool health", region: REGION, view: "timeSeries", stacked: false,
      metrics: [ m("PoolAvailable", { stat: "Maximum", label: "available" }), m("PoolLeased", { stat: "Maximum", label: "leased" }), m("PoolStuck", { stat: "Maximum", label: "stuck" }) ], yAxis: { left: { min: 0 } } } },
    { type: "metric", x: 12, y: 0, width: 12, height: 6, properties: { title: "Launch outcomes", region: REGION, view: "timeSeries", stacked: true,
      metrics: [ m("Launch", { dim: { Name: "Outcome", Value: "cold" }, label: "cold" }), m("Launch", { dim: { Name: "Outcome", Value: "warm" }, label: "warm" }), m("Launch", { dim: { Name: "Outcome", Value: "freebusy" }, label: "queued" }), m("Launch", { dim: { Name: "Outcome", Value: "nocapacity" }, label: "no-capacity" }), m("Launch", { dim: { Name: "Outcome", Value: "limit" }, label: "rate-limited" }) ] } },
    { type: "metric", x: 0, y: 6, width: 12, height: 6, properties: { title: "Cold deploy time (s)", region: REGION, view: "timeSeries",
      metrics: [ m("ColdDeploySeconds", { dim: { Name: "Outcome", Value: "success" }, stat: "Average", label: "avg" }), m("ColdDeploySeconds", { dim: { Name: "Outcome", Value: "success" }, stat: "p90", label: "p90" }) ], yAxis: { left: { min: 0 } } } },
    { type: "metric", x: 12, y: 6, width: 12, height: 6, properties: { title: "Failures & errors", region: REGION, view: "timeSeries", stacked: false,
      metrics: [ m("Deploy", { dim: { Name: "Outcome", Value: "failed" }, label: "deploy-failed" }), m("Teardown", { dim: { Name: "Outcome", Value: "failed" }, label: "teardown-failed" }), m("EngineError", { label: "engine-500" }) ] } },
    { type: "metric", x: 0, y: 12, width: 24, height: 4, properties: { title: "Cron heartbeats (should be > 0)", region: REGION, view: "timeSeries", stacked: false,
      metrics: [ m("ReapRun", { label: "reaper" }), m("WarmRun", { label: "warmer" }) ] } },
  ],
};
await cw.send(new PutDashboardCommand({ DashboardName: "ShieldSyncLabs", DashboardBody: JSON.stringify(body) }));
console.log(`  dashboard ✓ ShieldSyncLabs`);

console.log(`\n✅ Observability set up. Dashboard: CloudWatch → Dashboards → ShieldSyncLabs (us-east-1).`);
console.log(`   ${already && already.SubscriptionArn !== "PendingConfirmation" ? "Email already confirmed." : "⚠️  CONFIRM the SNS email to start receiving alerts."}`);
