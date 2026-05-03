"use client";

// Persistent top navigation per docs/spec/02-information-architecture.md.
// - Left: project name "RSN Yield Platform" → /
// - Center: five view links with an active-route indicator
// - Right: About link (Year/Calendar selectors live on the report pages)

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const VIEW_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/inventory", label: "Inventory" },
  { href: "/rates", label: "Rates" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/booking-matrix", label: "Booking Matrix" },
  { href: "/yield-summary", label: "Yield Summary" },
];

export function TopNav() {
  const pathname = usePathname() ?? "/";

  function isActive(href: string): boolean {
    // Active when the path is exactly the route or sits underneath it.
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-[1600px] items-center gap-8 px-6 py-3">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-slate-900 hover:text-indigo-600"
        >
          RSN Yield Platform
        </Link>
        <ul className="flex flex-1 items-center justify-center gap-6">
          {VIEW_LINKS.map((v) => {
            const active = isActive(v.href);
            return (
              <li key={v.href}>
                <Link
                  href={v.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "-mb-[2px] inline-block border-b-2 pb-1 text-sm transition-colors",
                    active
                      ? "border-indigo-500 font-medium text-slate-900"
                      : "border-transparent text-slate-600 hover:text-indigo-600",
                  )}
                >
                  {v.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <Link
            href="/about"
            aria-current={isActive("/about") ? "page" : undefined}
            className={clsx(
              "-mb-[2px] inline-block border-b-2 pb-1 transition-colors",
              isActive("/about")
                ? "border-indigo-500 font-medium text-slate-900"
                : "border-transparent hover:text-indigo-600",
            )}
          >
            About
          </Link>
        </div>
      </nav>
    </header>
  );
}
