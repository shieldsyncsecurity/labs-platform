import type { Metadata } from "next";
import "./globals.css";

// Internal tool — never index, never follow, regardless of how the URL is reached.
export const metadata: Metadata = {
  title: "ShieldSync HR",
  description: "ShieldSync internal HR document portal.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
