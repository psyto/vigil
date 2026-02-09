import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vigil — Restaking Risk Simulator",
  description: "Interactive pricing demo for Vigil's on-chain restaking risk programs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-vigil-bg antialiased">{children}</body>
    </html>
  );
}
