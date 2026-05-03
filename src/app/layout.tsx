import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";

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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <TopNav />
        <main className="mx-auto max-w-[1536px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
