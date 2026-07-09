import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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

const APP_URL = "https://enterprise.shieldsyncsecurity.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "ShieldSync Enterprise",
    template: "%s · ShieldSync Enterprise",
  },
  description:
    "Real-world cloud security assessments for hiring. Evaluate candidates in live, isolated AWS environments instead of whiteboard trivia.",
  openGraph: {
    siteName: "ShieldSync Enterprise",
    type: "website",
    locale: "en",
    url: "/",
    images: [
      {
        url: "/og/enterprise-og.png",
        width: 1200,
        height: 630,
        alt: "ShieldSync Enterprise - cloud security hiring assessments in real AWS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og/enterprise-og.png"],
  },
  // Global default = noindex: employer + candidate flows are invite/token-gated
  // and must never be indexed. Public marketing pages (/, /demo/report, /privacy,
  // /terms) opt back in with an explicit per-page `robots` override -- keep that
  // pattern for any new public page.
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
