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

export type Entitlement = {
  /** A lab slug for free/per-lab; "*" for monthly all-access. */
  labSlug: string;
  kind: EntitlementKind;
  /** ISO timestamp the access window ends; null = none tracked yet. */
  accessUntil: string | null;
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
