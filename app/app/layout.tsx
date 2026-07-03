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

const APP_URL = "https://labs.shieldsyncsecurity.com";
const MARKETING_URL = "https://shieldsyncsecurity.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "AWS Security Labs — ShieldSync Labs",
    template: "%s · ShieldSync Labs",
  },
  description:
    "Hands-on AWS security labs in real, isolated AWS accounts. Practice IAM, S3, encryption, GuardDuty, VPC and detection with auto-wipe when you're done. First lab free.",
  keywords: [
    "AWS security labs",
    "AWS cloud security",
    "hands-on AWS labs",
    "AWS IAM lab",
    "AWS S3 security lab",
    "cyber range",
  ],
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "ShieldSync Labs",
    title: "AWS Security Labs — ShieldSync Labs",
    description:
      "Real, isolated AWS accounts in your browser. Practice IAM, S3, encryption, GuardDuty, VPC. First lab free.",
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "AWS Security Labs — ShieldSync Labs",
    description: "Real, isolated AWS accounts in your browser. First lab free.",
  },
  // Public catalog + lab detail pages are indexable. Authenticated pages
  // (dashboard, account, admin, sign-in) override this in their own page.tsx.
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

const ORG_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${MARKETING_URL}/#organization`,
  name: "ShieldSync Security Private Limited",
  url: MARKETING_URL,
  logo: `${MARKETING_URL}/logo.svg`,
  sameAs: [APP_URL],
};

const WEBSITE_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${APP_URL}/#website`,
  name: "ShieldSync Labs",
  url: APP_URL,
  description: "Hands-on AWS security labs in real, isolated AWS accounts.",
  publisher: { "@id": `${MARKETING_URL}/#organization` },
  inLanguage: "en",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify([ORG_SCHEMA, WEBSITE_SCHEMA]) }}
        />
      </head>
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
