import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gatehouse replay",
  description: "One scripted agent session replayed three ways: shared service account, per-user token, and through the gateway.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
