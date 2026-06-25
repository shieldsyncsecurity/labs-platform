// CloudWatch metrics via Embedded Metric Format (EMF).
//
// We just log a specially-shaped JSON line to stdout; the Lambda log group
// auto-extracts it into CloudWatch metrics under the ShieldSyncLabs namespace.
// No PutMetricData API calls, no extra IAM permission, near-zero cost. Alarms +
// the dashboard are built on these metrics.
//
//   metric({ Deploy: 1, ColdDeploySeconds: 84 }, { Outcome: "success" });
//   metric({ PoolAvailable: 3, PoolLeased: 0 });            // no dimensions
//
// Keep dimension VALUES low-cardinality (Outcome buckets, not ids) — each unique
// (metric, dimension-value) pair is a billable custom metric.

const NAMESPACE = "ShieldSyncLabs";
const UNITS = {
  ColdDeploySeconds: "Seconds",
  TeardownSeconds: "Seconds",
  PoolAvailable: "Count",
  PoolLeased: "Count",
  PoolStuck: "Count",
};

export function metric(values, dimensions = {}) {
  try {
    const names = Object.keys(values).filter((n) => typeof values[n] === "number");
    if (!names.length) return;
    const dimKeys = Object.keys(dimensions);
    const record = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [dimKeys], // single dimension set (may be empty = no dims)
            Metrics: names.map((n) => ({ Name: n, Unit: UNITS[n] || "Count" })),
          },
        ],
      },
      ...dimensions,
      ...Object.fromEntries(names.map((n) => [n, values[n]])),
    };
    console.log(JSON.stringify(record));
  } catch {
    // metrics must never break the request path
  }
}
