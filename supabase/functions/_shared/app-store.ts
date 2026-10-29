/**
 * App Store Server API client — the source of truth for Tripseek+ subscriptions.
 *
 * Needs an In-App Purchase key (App Store Connect → Users and Access → Integrations →
 * In-App Purchase) stored as secrets:
 *   APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY (.p8 contents)
 *   APPLE_BUNDLE_ID (optional, defaults to com.tripseek.app)
 */

import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.2.2/index.ts";
import { type AppleTransaction, decodeJwsPayload } from "./app-store-utils.ts";

const PRODUCTION_URL = "https://api.storekit.itunes.apple.com";
const SANDBOX_URL = "https://api.storekit-sandbox.itunes.apple.com";

export interface AppStoreConfig {
  keyId: string;
  issuerId: string;
  privateKey: string;
  bundleId: string;
}

/** Reads the In-App Purchase key secrets. Returns null until they're set. */
export function appStoreConfig(): AppStoreConfig | null {
  const keyId = Deno.env.get("APPLE_IAP_KEY_ID");
  const issuerId = Deno.env.get("APPLE_IAP_ISSUER_ID");
  const privateKey = Deno.env.get("APPLE_IAP_PRIVATE_KEY");
  if (!keyId || !issuerId || !privateKey) return null;
  return {
    keyId,
    issuerId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
    bundleId: Deno.env.get("APPLE_BUNDLE_ID") ?? "com.tripseek.app",
  };
}

let cachedKey: CryptoKey | null = null;

async function apiToken(config: AppStoreConfig): Promise<string> {
  cachedKey ??= await importPKCS8(config.privateKey, "ES256");
  return new SignJWT({ bid: config.bundleId })
    .setProtectedHeader({ alg: "ES256", kid: config.keyId, typ: "JWT" })
    .setIssuer(config.issuerId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("appstoreconnect-v1")
    .sign(cachedKey);
}

export interface SubscriptionState {
  environment: "Production" | "Sandbox";
  /** Apple status: 1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked */
  appleStatus: number;
  transaction: AppleTransaction;
}

/**
 * Ask Apple for the current state of the subscription that `transactionId` belongs to
 * (Get All Subscription Statuses). Tries production first, then the sandbox — App Review
 * and TestFlight purchases live in the sandbox. Returns null if Apple doesn't know it.
 */
export async function fetchSubscriptionState(
  config: AppStoreConfig,
  transactionId: string,
  preferSandbox = false,
): Promise<SubscriptionState | null> {
  const token = await apiToken(config);
  const environments: ["Production" | "Sandbox", string][] = preferSandbox
    ? [["Sandbox", SANDBOX_URL], ["Production", PRODUCTION_URL]]
    : [["Production", PRODUCTION_URL], ["Sandbox", SANDBOX_URL]];

  let unauthorized = false;
  for (const [environment, baseUrl] of environments) {
    const resp = await fetch(`${baseUrl}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 404) continue; // not in this environment
    // Production refuses apps that haven't been released yet, while sandbox (App Review,
    // TestFlight) still works — so try the other environment before failing
    if (resp.status === 401) {
      unauthorized = true;
      continue;
    }
    if (!resp.ok) throw new Error(`App Store Server API error ${resp.status}`);

    const body = await resp.json() as {
      data?: { lastTransactions?: { status: number; signedTransactionInfo: string }[] }[];
    };
    let best: SubscriptionState | null = null;
    for (const group of body.data ?? []) {
      for (const last of group.lastTransactions ?? []) {
        const transaction = decodeJwsPayload<AppleTransaction>(last.signedTransactionInfo);
        const candidate: SubscriptionState = { environment, appleStatus: last.status, transaction };
        const isLive = (s: SubscriptionState) => s.appleStatus === 1 || s.appleStatus === 4;
        // Prefer a live subscription; otherwise the one that expired most recently
        if (
          !best ||
          (isLive(candidate) && !isLive(best)) ||
          (isLive(candidate) === isLive(best) && (transaction.expiresDate ?? 0) > (best.transaction.expiresDate ?? 0))
        ) {
          best = candidate;
        }
      }
    }
    return best;
  }
  if (unauthorized) throw new Error("App Store Server API error 401");
  return null;
}
