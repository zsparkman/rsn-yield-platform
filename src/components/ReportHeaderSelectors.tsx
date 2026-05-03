"use client";

// Year + Calendar selectors that mount in the top-right of every report
// page header. Two native <details> dropdowns with dotted underlines and a
// small chevron — minimal, no animation, no overlay backdrop. The Year
// selector is currently a single-option placeholder for the multi-year
// extension; the Calendar selector wires through to each view's grouping.

import { useEffect, useRef } from "react";
import clsx from "clsx";

export type CalendarMode = "standard" | "broadcast";

const YEAR_OPTIONS = ["2026"] as const;
const CALENDAR_OPTIONS: Array<{ value: CalendarMode; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "broadcast", label: "Broadcast" },
];

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx("size-3.5", className)}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

interface SelectorProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}

function Selector<T extends string>({ label, value, options, onChange }: SelectorProps<T>) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) ref.current.open = false;
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const current = options.find((o) => o.value === value)?.label ?? value;

  return (
    <details ref={ref} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}:
        </span>
        <span className="border-b border-dotted border-slate-700">{current}</span>
        <ChevronDown className="text-slate-400" />
      </summary>
      <div className="absolute right-0 top-full z-30 mt-1 min-w-[8rem] overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              onChange(o.value);
              if (ref.current) ref.current.open = false;
            }}
            className={clsx(
              "block w-full px-3 py-1.5 text-left text-sm",
              o.value === value
                ? "bg-indigo-50 font-medium text-indigo-700"
                : "text-slate-700 hover:bg-slate-50",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function ReportHeaderSelectors({
  year, onYear, calendar, onCalendar,
}: {
  year: string;
  onYear: (y: string) => void;
  calendar: CalendarMode;
  onCalendar: (c: CalendarMode) => void;
}) {
  return (
    <div className="flex items-center gap-5">
      <Selector
        label="Year"
        value={year}
        options={YEAR_OPTIONS.map((y) => ({ value: y, label: y }))}
        onChange={onYear}
      />
      <Selector
        label="Calendar"
        value={calendar}
        options={CALENDAR_OPTIONS}
        onChange={onCalendar}
      />
    </div>
  );
}
