// Persistent top navigation per docs/spec/02-information-architecture.md.
// - Left: project name "RSN Yield Platform" → /
// - Center: five view links
// - Right: About link (Year/Calendar selectors live on the report pages
//   themselves rather than the global nav)

import Link from "next/link";

const VIEW_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/inventory", label: "Inventory" },
  { href: "/rates", label: "Rates" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/booking-matrix", label: "Booking Matrix" },
  { href: "/yield-summary", label: "Yield Summary" },
];

export function TopNav() {
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
          {VIEW_LINKS.map((v) => (
            <li key={v.href}>
              <Link
                href={v.href}
                className="text-sm text-slate-600 hover:text-indigo-600"
              >
                {v.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <Link href="/about" className="hover:text-indigo-600">
            About
          </Link>
        </div>
      </nav>
    </header>
  );
}
