import Link from "next/link";

export const metadata = { title: "About · RSN Yield Platform" };

export default function AboutPage() {
  return (
    <article className="prose mx-auto max-w-3xl space-y-8 py-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          About this demo
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Three short sections: what this is, the sanitization commitment,
          and the technical approach.
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">What this is</h2>
        <p>
          A portfolio demonstration of an RSN ad inventory and yield-management
          platform. The real platform underlying this work manages on the order
          of $30–60 MM in annual ad revenue across an MLB-team regional sports
          network spanning ~170 televised games per season, plus pre-season,
          ancillary programming, and a long tail of make-good and bonus
          inventory. This demo replicates the full Power Query → Pivot Table
          chain with synthetic data, so the same pipeline could in theory be
          pointed at real Wide Orbit / SSRS exports with no code change other
          than swapping the four input files.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">
          Sanitization commitment
        </h2>
        <p>
          No real client names, rates, fill numbers, revenue figures, or
          schedule data appear anywhere in this codebase. The home team
          (&ldquo;Sentinels&rdquo;) is fictional; opponents are real MLB
          teams used only as scheduling structure. The 220-advertiser pool
          is drawn from a synthetic SSRS export
          (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            docs/reference/PPIRSNBookedSpots2026_synthetic.csv
          </code>);
          the rate card and inventory capacity tables are likewise synthetic
          replacements for the real ones. All synthetic data was generated
          from distributional priors derived from operational experience, not
          from any real dataset.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">
          Technical approach
        </h2>
        <p>
          Next.js App Router with static export. Synthetic data is generated
          deterministically from a single seed
          (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            rsn-yield-platform-v1
          </code>)
          into four source files in{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/data</code>
          : a 29-column Wide Orbit spots CSV, a 10-column Master Game Schedule
          CSV, and two xlsx files for the inventory capacity table and the
          dynamic rate card. An ETL module
          (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            src/lib/etl.ts
          </code>)
          implements five named functions mirroring the Power Query M chain:
          deriveSpots, deriveSchedule, deriveSpotsByClient, deriveInventory,
          and deriveAurSummary. Joins use
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            Map&lt;string, T&gt;
          </code>
          on tuple keys instead of literal join-key columns; per-LOB and
          per-spot-group aggregates are computed in single passes.
        </p>
        <p>
          ETL output is gated by 53 property-based contracts
          (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            docs/spec/05-etl-contracts.md
          </code>)
          and 24 distributional calibration metrics. The build fails non-zero
          if any contract or metric misses. Views consume the typed ETL output
          directly — no runtime data fetching.
        </p>
        <p>
          <Link
            href="https://github.com/zsparkman/rsn-yield-platform"
            className="text-indigo-600 hover:underline"
          >
            Source on GitHub
          </Link>
        </p>
      </section>
    </article>
  );
}
