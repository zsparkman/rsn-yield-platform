// Generic filter strip building blocks. Each filter is a small labeled
// segmented control rendered as a horizontal flex row. Filter state lives
// in the parent client component.

"use client";

import clsx from "clsx";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="flex overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={clsx(
              "px-2.5 py-1 text-xs transition-colors",
              o.value === value
                ? "bg-indigo-600 text-white"
                : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DateRangeFilter({
  startDate,
  endDate,
  onStart,
  onEnd,
  min,
  max,
}: {
  startDate: string;
  endDate: string;
  onStart: (next: string) => void;
  onEnd: (next: string) => void;
  min: string;
  max: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Dates
      </span>
      <input
        type="date"
        value={startDate}
        min={min}
        max={max}
        onChange={(e) => onStart(e.target.value)}
        className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-slate-700 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      <span className="text-xs text-slate-400">–</span>
      <input
        type="date"
        value={endDate}
        min={min}
        max={max}
        onChange={(e) => onEnd(e.target.value)}
        className="rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-xs text-slate-700 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}
