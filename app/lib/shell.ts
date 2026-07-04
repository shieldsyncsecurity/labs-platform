// Shared shell width rule for the header + footer. Wide "app" pages (the
// two-panel lab guide, dashboard, admin) use the full 1536px shell; browse
// pages (catalog, account, sign-in) read better at a narrower 6xl column.
// Keep in sync with each page's own container max-width.
export function shellMaxWidth(pathname: string): string {
  const wide = pathname === "/dashboard" || pathname.startsWith("/labs/") || pathname.startsWith("/admin");
  return wide ? "max-w-[1536px]" : "max-w-6xl";
}
