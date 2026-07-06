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
  // Employer + candidate flows are invite/token-gated; keep this out of the
  // public index until there is real marketing copy here (TODO before launch).
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
