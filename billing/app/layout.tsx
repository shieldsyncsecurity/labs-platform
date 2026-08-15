export const metadata = {
  title: "ShieldSync Billing",
  description: "Invoice portal for ShieldSync Security.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
