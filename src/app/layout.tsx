import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Scalping V2 — Finex Indonesia Auto Trader",
  description:
    "Fullstack automated forex scalping system: MT5 + Ollama llama3.2 AI + Tiingo calendar. Strategi V2 (RR net ≥ 2.0, ATR-based SL, ADX regime filter).",
  keywords: [
    "forex",
    "scalping",
    "MT5",
    "Ollama",
    "llama3.2",
    "Tiingo",
    "Finex Indonesia",
    "automated trading",
    "V2 strategy",
  ],
  authors: [{ name: "Z.ai" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
