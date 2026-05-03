import Link from "next/link";

const VIEWS: ReadonlyArray<{
  href: string;
  name: string;
  desc: string;
}> = [
  {
    href: "/inventory",
    name: "Inventory",
    desc: "Capacity, units sold, avails, sellout & net revenue by date, matchup, and inventory type.",
  },
  {
    href: "/rates",
    name: "Rates",
    desc: "Open avails and current resolved rate per inventory type, grouped by week.",
  },
  {
    href: "/heatmap",
    name: "Heatmap",
    desc: "Per-game sellout percentage by inventory type, monthly groupings.",
  },
  {
    href: "/booking-matrix",
    name: "Booking Matrix",
    desc: "Top advertisers × dates matrix of EQ30 by spot status and inventory type.",
  },
  {
    href: "/yield-summary",
    name: "Yield Summary",
    desc: "LOB × spot-group decomposition with EUR (Net), AUR, and sellout per game.",
  },
];

export default function Landing() {
  return (
    <div className="grid min-h-[calc(100vh-9rem)] grid-rows-[auto_1fr_auto] gap-8">
      {/* Header */}
      <section className="pt-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
          RSN Yield Platform
        </h1>
        <p className="mt-2 text-base text-slate-600">
          Inventory, rate, and yield management for a regional sports network.
        </p>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600">
          A sanitized portfolio version of a production yield-management tool
          for an MLB-team regional sports network. The pipeline mirrors a
          real-world Wide Orbit + Excel chain at a 170-game-per-season scale
          and a roughly $30–60 MM annual ad-revenue range. All data shown is
          synthetic.
        </p>
      </section>

      {/* View cards */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {VIEWS.map((v) => (
          <Link
            key={v.href}
            href={v.href}
            className="group flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-600"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-slate-400 group-hover:bg-indigo-600"
              />
              <span className="text-sm font-medium text-slate-900 group-hover:text-indigo-600">
                {v.name}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">{v.desc}</p>
          </Link>
        ))}
      </section>

      {/* Footer */}
      <footer className="flex flex-col items-start gap-2 border-t border-slate-200 pt-4 text-xs text-slate-600 md:flex-row md:items-center md:justify-between">
        <p>
          All data shown is synthetic. No real client names, rates, fill
          numbers, or revenue figures appear in this demo.{" "}
          <Link href="/about" className="text-indigo-600 hover:underline">
            More
          </Link>
          .
        </p>
        <p>Built by Zach Sparkman</p>
      </footer>
    </div>
  );
}
