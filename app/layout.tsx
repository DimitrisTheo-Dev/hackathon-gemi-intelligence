import type { Metadata, Viewport } from "next";
import { Gabarito, Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "greek"],
  display: "swap",
});

const gabarito = Gabarito({
  variable: "--font-gabarito",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GEMI Intelligence",
  description: "Type any Greek company name and get a due diligence report in 60 seconds.",
};

export const viewport: Viewport = {
  themeColor: "#05080f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${inter.variable} ${gabarito.variable}`}>{children}</body>
    </html>
  );
}
