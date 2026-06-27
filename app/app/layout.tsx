import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/context";
import { SiteHeader } from "@/components/site-header";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "ShieldSync Labs", template: "%s · ShieldSync Labs" },
  description: "Hands-on AWS cloud-security labs in real, isolated AWS accounts.",
  // The authenticated platform app is not for search indexing.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-line bg-surface">
            <div className="mx-auto flex max-w-[1536px] flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
              <span>ShieldSync Labs · hands-on cloud security · each lab runs in its own isolated, auto-destroyed AWS account.</span>
              <a href="https://shieldsyncsecurity.com" className="whitespace-nowrap font-semibold text-ink-soft hover:text-ink">
                ← Back to ShieldSync.com
              </a>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
