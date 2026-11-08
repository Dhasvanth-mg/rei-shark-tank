import type { Metadata, Viewport } from "next";
import { Cinzel, Manrope } from "next/font/google";
import "./globals.css";

const display = Cinzel({ variable: "--font-display", subsets: ["latin"], weight: ["600", "800", "900"] });
const body = Manrope({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "REI Shark Tank | Real Estate Investor Challenge",
  description: "Rho Epsilon Iota's live real estate investing game. Build a portfolio, survive the market, win.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#12264a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
