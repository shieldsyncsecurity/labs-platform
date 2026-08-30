import { hrFetch } from "@/lib/server/hr-engine";
import { gstin as envGstin } from "@/lib/company";

/** In-app GST configuration — owner-editable in the portal (Tax page), so the
 * owner can switch GST on and enter the GSTIN the day it arrives, with no code
 * change or deploy. Stored on the engine's config singleton. */
export type GstSettings = {
  /** Off until the GSTIN is received. Nothing charges GST while this is false. */
  registered: boolean;
  /** The company's GSTIN, or null when unset. */
  gstin: string | null;
  /** Default GST rate to prefill on a new invoice (India services = 18%). */
  defaultRate: number;
};

const DEFAULT_RATE = 18;

/**
 * Reads GST settings from the engine. Falls back to the legacy env GSTIN
 * (SHIELDSYNC_GSTIN) when the setting is unset, so an existing env value keeps
 * working until the owner sets it in-app. Fails SAFE to "not registered" if the
 * store is unreachable — better to omit GST than to charge or claim it wrongly.
 */
export async function getGstSettings(): Promise<GstSettings> {
  try {
    const { settings } = await hrFetch<{ settings?: { gstRegistered?: boolean; gstin?: string; gstRate?: number } }>("/hr/settings");
    const gstin = (settings?.gstin ?? "").trim() || envGstin();
    return {
      registered: Boolean(settings?.gstRegistered),
      gstin: gstin || null,
      defaultRate: typeof settings?.gstRate === "number" && settings.gstRate > 0 ? settings.gstRate : DEFAULT_RATE,
    };
  } catch {
    return { registered: false, gstin: envGstin(), defaultRate: DEFAULT_RATE };
  }
}
