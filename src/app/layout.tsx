import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/TopNav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RSN Yield Platform",
  description:
    "Inventory, rate, and yield management for a regional sports network.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#F4F6F9] text-slate-900">
        <div
          aria-hidden
          className="fixed inset-x-0 top-0 z-50 h-[3px] bg-[#0F172A]"
        />
        <TopNav />
        <main className="mx-auto max-w-[1536px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
