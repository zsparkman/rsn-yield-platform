"use client";

// AUR Report view per IA View 5. The senior view: per-(date, inv-type)
// rows decomposed by LOB × spot group, with monthly subtotals and a
// season-to-date total. LOB toggle: All / Direct (Non-HTS) / Repped (HTS).

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { AurSummaryRow, SeasonPhase } from "@/lib/types";
import {
  fmtCurrencyRolled,
  fmtCurrencyUnit,
  fmtEq30,
  fmtIsoLong,
  fmtPercent,
  selloutHeat,
} from "@/lib/format";
import { Segment } from "@/components/FilterStrip";
import { ReportHeaderSelectors, type CalendarMode } from "@/components/ReportHeaderSelectors";

type LobFilter = "All" | "Direct" | "Repped";
type PhaseFilter = "All" | SeasonPhase;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface RowSlice {
  date: string;
  type2: SeasonPhase;
  invType: string;
  standardMonth: string;
  bcastMonth: string;
  paidEq30: number;
  ncEq30: number;
  aduEq30: number;
  xaduEq30: number;
  bonusEq30: number;
  totalEq30: number;
  paidNetCents: number;
  paidCount: number;
  avails: number;
}

function sliceFor(row: AurSummaryRow, lob: LobFilter): RowSlice {
  const paidEq30 =
    lob === "All" ? row["Total Paid.EQ30"]
    : lob === "Direct" ? row["Non-HTS Paid.EQ30"]
    : row["HTS Paid.EQ30"];
  const paidNetDollars =
    lob === "All" ? row["Total Paid.Net REV"]
    : lob === "Direct" ? row["Non-HTS Paid.Net REV"]
    : row["HTS Paid.Net REV"];
  const paidCount =
    lob === "All" ? (row["HTS Paid.count"] + row["Non-HTS Paid.count"])
    : lob === "Direct" ? row["Non-HTS Paid.count"]
    : row["HTS Paid.count"];
  const ncEq30 =
    lob === "All" ? row["Total NC.EQ30"]
    : lob === "Direct" ? row["Non-HTS NC.EQ30"]
    : row["HTS NC.EQ30"];
  const aduEq30 =
    lob === "All" ? row["Total ADU.EQ30"]
    : lob === "Direct" ? row["Non-HTS ADU.EQ30"]
    : row["HTS ADU.EQ30"];
  const xaduEq30 =
    lob === "All" ? row["Total Cross Property ADU.EQ30"]
    : lob === "Direct" ? row["Non-HTS Cross Property ADU.EQ30"]
    : row["HTS Cross Property ADU.EQ30"];
  const bonusEq30 =
    lob === "All" ? row["Total Bonus.EQ30"]
    : lob === "Direct" ? row["Non-HTS Bonus.EQ30"]
    : row["HTS Bonus.EQ30"];
  const totalEq30 = paidEq30 + ncEq30 + aduEq30 + xaduEq30 + bonusEq30;

  return {
    date: row.DATE,
    type2: row.TYPE2,
    invType: row["INV TYPE"],
    standardMonth: row.broadcast_month,
    bcastMonth: row.bcast_month,
    paidEq30,
    ncEq30,
    aduEq30,
    xaduEq30,
    bonusEq30,
    totalEq30,
    paidNetCents: Math.round(paidNetDollars * 100),
    paidCount,
    avails: row.Avails,
  };
}

function eurNetCentsOf(slice: RowSlice): number {
  return slice.paidEq30 > 0
    ? Math.round(slice.paidNetCents / slice.paidEq30)
    : 0;
}

function aurCentsOf(slice: RowSlice): number {
  return slice.paidCount > 0
    ? Math.round(slice.paidNetCents / slice.paidCount)
    : 0;
}

function selloutOf(slice: RowSlice): number {
  return slice.avails > 0 ? (slice.paidEq30 + slice.ncEq30) / slice.avails : 0;
}

function selloutAduOf(slice: RowSlice): number {
  return slice.avails > 0
    ? (slice.paidEq30 + slice.ncEq30 + slice.aduEq30 + slice.xaduEq30) / slice.avails
    : 0;
}

interface MonthAgg {
  month: string;
  rows: RowSlice[];
  agg: RowSlice;
}

function invSort(invType: string): number {
  if (invType === "Pregame") return 0;
  if (invType.startsWith("In Game")) return 1;
  if (invType === "Postgame") return 2;
  return 9;
}

function groupRowsByDate(rows: RowSlice[]): Array<{ date: string; rows: RowSlice[]; agg: RowSlice }> {
  const map = new Map<string, RowSlice[]>();
  for (const r of rows) {
    const list = map.get(r.date) ?? [];
    list.push(r);
    map.set(r.date, list);
  }
  const out: Array<{ date: string; rows: RowSlice[]; agg: RowSlice }> = [];
  for (const [date, rs] of map.entries()) {
    rs.sort((a, b) => invSort(a.invType) - invSort(b.invType));
    out.push({ date, rows: rs, agg: aggregateRows(rs, rs[0].standardMonth, rs[0].bcastMonth) });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function aggregateRows(rows: RowSlice[], standardMonth: string, bcastMonth: string): RowSlice {
  const agg: RowSlice = {
    date: "", type2: "REG", invType: "Total",
    standardMonth, bcastMonth,
    paidEq30: 0, ncEq30: 0, aduEq30: 0, xaduEq30: 0, bonusEq30: 0,
    totalEq30: 0, paidNetCents: 0, paidCount: 0, avails: 0,
  };
  for (const r of rows) {
    agg.paidEq30 += r.paidEq30;
    agg.ncEq30 += r.ncEq30;
    agg.aduEq30 += r.aduEq30;
    agg.xaduEq30 += r.xaduEq30;
    agg.bonusEq30 += r.bonusEq30;
    agg.totalEq30 += r.totalEq30;
    agg.paidNetCents += r.paidNetCents;
    agg.paidCount += r.paidCount;
    agg.avails += r.avails;
  }
  return agg;
}

export function YieldSummaryTable({ rows }: { rows: AurSummaryRow[] }) {
  const [lob, setLob] = useState<LobFilter>("All");
  const [phase, setPhase] = useState<PhaseFilter>("All");
  const [legendOpen, setLegendOpen] = useState(true);
  const [year, setYear] = useState("2026");
  const [calendar, setCalendar] = useState<CalendarMode>("standard");

  const slices = useMemo(() => {
    return rows
      .map((r) => sliceFor(r, lob))
      .filter((s) => phase === "All" || s.type2 === phase);
  }, [rows, lob, phase]);

  const monthOf = (s: RowSlice) =>
    calendar === "broadcast" ? s.bcastMonth : s.standardMonth;

  const groupedByMonth = useMemo(() => {
    const map = new Map<string, RowSlice[]>();
    for (const s of slices) {
      const k = monthOf(s);
      const list = map.get(k) ?? [];
      list.push(s);
      map.set(k, list);
    }
    const out: MonthAgg[] = [];
    for (const [month, rs] of map.entries()) {
      rs.sort((a, b) => a.date.localeCompare(b.date) || invSort(a.invType) - invSort(b.invType));
      out.push({ month, rows: rs, agg: aggregateRows(rs, month, month) });
    }
    out.sort((a, b) => MONTHS.indexOf(a.month) - MONTHS.indexOf(b.month));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slices, calendar]);

  const seasonAgg = useMemo(
    () => aggregateRows(slices, "Season", "Season"),
    [slices],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-5">
        <ReportHeaderSelectors
          year={year}
          onYear={setYear}
          calendar={calendar}
          onCalendar={setCalendar}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Segment<LobFilter>
          label="LOB"
          value={lob}
          options={[
            { value: "All", label: "All" },
            { value: "Direct", label: "Direct" },
            { value: "Repped", label: "Repped" },
          ]}
          onChange={setLob}
        />
        <Segment<PhaseFilter>
          label="Phase"
          value={phase}
          options={[
            { value: "All", label: "All" },
            { value: "PR", label: "PR" },
            { value: "REG", label: "REG" },
          ]}
          onChange={setPhase}
        />
        <span className="ml-auto text-xs text-slate-500">
          {slices.length} rows · {groupedByMonth.length} months
        </span>
      </div>

      {legendOpen && (
        <div className="rounded border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p>
                <strong>NC</strong> = contracted bonus &nbsp;|&nbsp;{" "}
                <strong>ADU</strong> = make-good &nbsp;|&nbsp;{" "}
                <strong>xADU</strong> = cross-property make-good &nbsp;|&nbsp;{" "}
                <strong>Bonus</strong> = added value
              </p>
              <p>
                <strong>EUR (Net)</strong> = Net Rev / Paid eq30
                (volume-weighted, duration-normalized)
              </p>
              <p>
                <strong>AUR</strong> = Net Rev / Paid units (volume-weighted in
                numerator, count-based; skewed lower by :15s, higher by :60s)
              </p>
              <p>
                <strong>Sellout</strong> = (Paid + NC) / Avails
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLegendOpen(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              Hide
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="grid-table w-full text-[13px] leading-tight">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Inv</th>
              <th className="px-3 py-2 text-right num">Avail</th>
              <th className="px-3 py-2 text-right num">Paid</th>
              <th className="px-3 py-2 text-right num">NC</th>
              <th className="px-3 py-2 text-right num">ADU</th>
              <th className="px-3 py-2 text-right num">xADU</th>
              <th className="px-3 py-2 text-right num">Bonus</th>
              <th className="px-3 py-2 text-right num">Total</th>
              <th className="px-3 py-2 text-right num">Net REV</th>
              <th className="px-3 py-2 text-right num">AUR</th>
              <th className="px-3 py-2 text-right num">EUR (Net)</th>
              <th className="px-3 py-2 text-right num">Sellout%</th>
              <th className="px-3 py-2 text-right num">Sellout+ADU%</th>
            </tr>
          </thead>
          <tbody>
            {groupedByMonth.map((m) => (
              <MonthBlock key={m.month} month={m} />
            ))}
            <tr className="border-y-2 border-slate-400 bg-indigo-50 font-semibold text-slate-800">
              <td colSpan={4} className="px-3 py-2 uppercase tracking-wide text-xs">
                Season-to-date · {phase === "All" ? "PR + REG" : phase}
              </td>
              <td className="num px-3 py-2 text-right">{fmtEq30(seasonAgg.avails)}</td>
              <td className="num px-3 py-2 text-right">{fmtEq30(seasonAgg.paidEq30)}</td>
              <td className="num px-3 py-2 text-right">{fmtEq30(seasonAgg.ncEq30)}</td>
              <td className="num px-3 py-2 text-right">{fmtEq30(seasonAgg.aduEq30)}</td>
              <td className="num px-3 py-2 text-right">{fmtEq30(seasonAgg.xaduEq30)}</td>
              <td className="num px-3 py-2 text-right">{fmtEq30(seasonAgg.bonusEq30)}</td>
              <td className="num px-3 py-2 text-right">{fmtEq30(seasonAgg.totalEq30)}</td>
              <td className="num px-3 py-2 text-right">{fmtCurrencyRolled(seasonAgg.paidNetCents)}</td>
              <td className="num px-3 py-2 text-right">{fmtCurrencyUnit(aurCentsOf(seasonAgg))}</td>
              <td className="num px-3 py-2 text-right">{fmtCurrencyUnit(eurNetCentsOf(seasonAgg))}</td>
              <td className={clsx("num px-3 py-2 text-right", selloutHeat(selloutOf(seasonAgg)))}>
                {fmtPercent(selloutOf(seasonAgg))}
              </td>
              <td className={clsx("num px-3 py-2 text-right", selloutHeat(selloutAduOf(seasonAgg)))}>
                {fmtPercent(selloutAduOf(seasonAgg))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthBlock({ month }: { month: MonthAgg }) {
  const dateGroups = groupRowsByDate(month.rows);
  return (
    <>
      <tr className="border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-700">
        <td colSpan={4} className="px-3 py-2">
          {month.month} · {month.rows.length} rows · {dateGroups.length} dates
        </td>
        <td colSpan={12}></td>
      </tr>
      {dateGroups.map((d) => (
        <DateBlock key={d.date} date={d.date} rows={d.rows} agg={d.agg} />
      ))}
      <tr className="border-y border-slate-400 bg-slate-200 text-xs font-semibold text-slate-800">
        <td colSpan={4} className="px-3 py-2 text-right uppercase tracking-wide">
          {month.month} subtotal
        </td>
        <td className="num px-3 py-2 text-right">{fmtEq30(month.agg.avails)}</td>
        <td className="num px-3 py-2 text-right">{fmtEq30(month.agg.paidEq30)}</td>
        <td className="num px-3 py-2 text-right">{fmtEq30(month.agg.ncEq30)}</td>
        <td className="num px-3 py-2 text-right">{fmtEq30(month.agg.aduEq30)}</td>
        <td className="num px-3 py-2 text-right">{fmtEq30(month.agg.xaduEq30)}</td>
        <td className="num px-3 py-2 text-right">{fmtEq30(month.agg.bonusEq30)}</td>
        <td className="num px-3 py-2 text-right">{fmtEq30(month.agg.totalEq30)}</td>
        <td className="num px-3 py-2 text-right">{fmtCurrencyRolled(month.agg.paidNetCents)}</td>
        <td className="num px-3 py-2 text-right">{fmtCurrencyUnit(aurCentsOf(month.agg))}</td>
        <td className="num px-3 py-2 text-right">{fmtCurrencyUnit(eurNetCentsOf(month.agg))}</td>
        <td className={clsx("num px-3 py-2 text-right", selloutHeat(selloutOf(month.agg)))}>
          {fmtPercent(selloutOf(month.agg))}
        </td>
        <td className={clsx("num px-3 py-2 text-right", selloutHeat(selloutAduOf(month.agg)))}>
          {fmtPercent(selloutAduOf(month.agg))}
        </td>
      </tr>
    </>
  );
}

function DateBlock({
  date, rows, agg,
}: {
  date: string;
  rows: RowSlice[];
  agg: RowSlice;
}) {
  return (
    <>
      {rows.map((s) => (
        <DataRow key={`${s.date}|${s.invType}`} s={s} />
      ))}
      <tr className="border-y border-slate-200 bg-slate-100 text-xs font-medium text-slate-700">
        <td className="px-3 py-1.5">{rows[0].type2}</td>
        <td className="px-3 py-1.5">{agg.standardMonth}</td>
        <td className="px-3 py-1.5">{fmtIsoLong(date)}</td>
        <td className="px-3 py-1.5 uppercase tracking-wide text-[11px]">Total</td>
        <td className="num px-3 py-1.5 text-right">{fmtEq30(agg.avails)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtEq30(agg.paidEq30)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtEq30(agg.ncEq30)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtEq30(agg.aduEq30)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtEq30(agg.xaduEq30)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtEq30(agg.bonusEq30)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtEq30(agg.totalEq30)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtCurrencyRolled(agg.paidNetCents)}</td>
        <td className="num px-3 py-1.5 text-right">{fmtCurrencyUnit(aurCentsOf(agg))}</td>
        <td className="num px-3 py-1.5 text-right">{fmtCurrencyUnit(eurNetCentsOf(agg))}</td>
        <td className={clsx("num px-3 py-1.5 text-right", selloutHeat(selloutOf(agg)))}>
          {fmtPercent(selloutOf(agg))}
        </td>
        <td className={clsx("num px-3 py-1.5 text-right", selloutHeat(selloutAduOf(agg)))}>
          {fmtPercent(selloutAduOf(agg))}
        </td>
      </tr>
    </>
  );
}

function DataRow({ s }: { s: RowSlice }) {
  const eurNet = eurNetCentsOf(s);
  const aur = aurCentsOf(s);
  // Yellow flag: AUR < EUR (Net) by > 5%
  const lengthMixDrag = eurNet > 0 && (eurNet - aur) / eurNet > 0.05;
  return (
    <tr className="border-b border-slate-50 last:border-b-0">
      <td className="px-3 py-1.5 text-slate-700">{s.type2}</td>
      <td className="px-3 py-1.5 text-slate-700">{s.standardMonth}</td>
      <td className="px-3 py-1.5 text-slate-700">{fmtIsoLong(s.date)}</td>
      <td className="px-3 py-1.5 text-slate-700">{s.invType}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtEq30(s.avails)}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtEq30(s.paidEq30)}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtEq30(s.ncEq30)}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtEq30(s.aduEq30)}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtEq30(s.xaduEq30)}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtEq30(s.bonusEq30)}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtEq30(s.totalEq30)}</td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtCurrencyRolled(s.paidNetCents)}</td>
      <td className={clsx("num px-3 py-1.5 text-right text-slate-700", lengthMixDrag && "bg-yellow-100")}>
        {fmtCurrencyUnit(aur)}
      </td>
      <td className="num px-3 py-1.5 text-right text-slate-700">{fmtCurrencyUnit(eurNet)}</td>
      <td className={clsx("num px-3 py-1.5 text-right", selloutHeat(selloutOf(s)))}>
        {fmtPercent(selloutOf(s))}
      </td>
      <td className={clsx("num px-3 py-1.5 text-right", selloutHeat(selloutAduOf(s)))}>
        {fmtPercent(selloutAduOf(s))}
      </td>
    </tr>
  );
}
