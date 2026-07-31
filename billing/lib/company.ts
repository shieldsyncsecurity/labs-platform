export const COMPANY = {
  legalName: "ShieldSync Security Private Limited",
  shortName: "ShieldSync",
  tagline: "Empowering Cybersecurity Futures",
  cin: "U62090UP2025PTC225398",
  pan: "ABQCS4200G",
  email: "info@shieldsyncsecurity.com",
  phone: "+91 97174 33114",
  website: "www.shieldsyncsecurity.com",
  locationLine: "Noida, Uttar Pradesh, India",
} as const;

export function registeredAddress(): string {
  return (process.env.SHIELDSYNC_ADDRESS ?? "").trim() || COMPANY.locationLine;
}

export function gstin(): string | null {
  const g = (process.env.SHIELDSYNC_GSTIN ?? "").trim();
  return g || null;
}
