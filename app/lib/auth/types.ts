// Auth is abstracted behind AuthClient so the app runs on a local mock today
// and drops onto Amazon Cognito (Google + LinkedIn) later with no UI changes.

export type AuthProviderId = "google" | "linkedin" | "dev";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  provider: AuthProviderId;
};

export type EntitlementKind = "free" | "per-lab" | "monthly";

/**
 * v2 entitlement type tag.
 *  - "LIFETIME"      grandfathered legacy rows + free/comped grants (no launch cap).
 *  - "PAY_PER_LAB"   one-time purchase: maxLaunches launches within a rolling
 *                    7-day window that starts on the FIRST launch (window fields
 *                    are stamped lazily at first-launch reservation).
 *  - "SUBSCRIPTION"  recurring all-access: gated by subscriptionStatus + dates,
 *                    not by launchCount.
 */
export type EntitlementType = "LIFETIME" | "PAY_PER_LAB" | "SUBSCRIPTION";

export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";

export type Entitlement = {
  /** A lab slug for free/per-lab; "*" for monthly all-access. */
  labSlug: string;
  kind: EntitlementKind;
  /** ISO timestamp the access window ends; null = none tracked yet. */
  accessUntil: string | null;

  // ── v2 fields (all optional for backward compat with legacy rows) ──
  /** Absent = treat as LIFETIME (legacy row). */
  type?: EntitlementType;
  /** Stamped on first PAY_PER_LAB launch (ISO). */
  windowStartedAt?: string | null;
  /** windowStartedAt + 7d, stamped atomically with the first launch (ISO). */
  windowExpiresAt?: string | null;
  /** Launches consumed in the current window. */
  launchCount?: number;
  /** Cap for PAY_PER_LAB (e.g. 30); null/absent for LIFETIME/SUBSCRIPTION. */
  maxLaunches?: number | null;
  /** Recurring billing identifier (provider subscription id). */
  subscriptionId?: string | null;
  subscriptionStartedAt?: string | null;
  subscriptionExpiresAt?: string | null;
  subscriptionStatus?: SubscriptionStatus | null;
  /** Optimistic-concurrency token; bumped on every reservation. */
  version?: number;
  /** Set by the engine when usage looks anomalous (kept for observability). */
  highUsageFlagged?: boolean;
  /** Order this grant traces back to (PAY_PER_LAB / SUBSCRIPTION). */
  orderId?: string | null;
};

/**
 * The single seam every auth backend implements.
 *  - MockAuthClient (lib/auth/context) backs local/offline dev.
 *  - CognitoAuthClient (lib/auth/cognito-adapter) is the production target.
 */
export interface AuthClient {
  getUser(): Promise<AuthUser | null>;
  signInWithProvider(provider: "google" | "linkedin"): Promise<AuthUser>;
  signOut(): Promise<void>;
  getEntitlements(userId: string): Promise<Entitlement[]>;
}
