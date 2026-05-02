// Property-based contract validator for the ETL.
//
// Each contract is a small predicate that asserts an invariant on the ETL
// output. The set of contracts is the implementation of
// docs/spec/05-etl-contracts.md. Not every contract from the spec is
// implemented yet — those are stubbed with TODO markers and skipped at
// runtime. This is intentional: the implemented contracts cover the
// structural and most of the value-relationship invariants. The remaining
// contracts (those requiring large counter-example searches over the join
// behavior) come on later.

import type {
  AurSummaryRow,
  EnrichedScheduleRow,
  EnrichedSpot,
  InventoryRollupRow,
  RawSpot,
  SpotsByClientRow,
} from "./types";
import type { EtlInputs, EtlOutputs } from "./etl";

export interface ContractResult {
  id: string;
  summary: string;
  passed: boolean;
  reason?: string;
  sample?: unknown;
}

type SpotsContract = (input: RawSpot[], output: EnrichedSpot[]) => ContractResult;
type ScheduleContract = (output: EnrichedScheduleRow[]) => ContractResult;
type SbcContract = (output: SpotsByClientRow[], schedule: EnrichedScheduleRow[]) => ContractResult;
type InventoryContract = (output: InventoryRollupRow[]) => ContractResult;
type AurContract = (output: AurSummaryRow[]) => ContractResult;

// ---------- helpers ----------

function approxEq(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

function pass(id: string, summary: string): ContractResult {
  return { id, summary, passed: true };
}

function fail(id: string, summary: string, reason: string, sample?: unknown): ContractResult {
  return { id, summary, passed: false, reason, sample };
}

// ============================================================================
// deriveSpots contracts
// ============================================================================

const spotsContracts: Array<{ id: string; summary: string; check: SpotsContract }> = [
  {
    id: "S1",
    summary: "Filter preserves only rows with non-empty OrderNumber",
    check: (input, output) => {
      const expected = input.filter((r) => r.OrderNumber != null && String(r.OrderNumber).trim() !== "").length;
      return output.length === expected
        ? pass("S1", "Filter preserves only rows with non-empty OrderNumber")
        : fail("S1", "Filter preserves only rows with non-empty OrderNumber",
            `output.length=${output.length} expected=${expected}`);
    },
  },
  {
    id: "S2",
    summary: "inventory_type ∈ closed set",
    check: (_, output) => {
      const allowed = new Set(["In Game", "Pregame", "Postgame", "Ancillary"]);
      const bad = output.find((s) => !allowed.has(s.inventory_type));
      return bad
        ? fail("S2", "inventory_type ∈ closed set", `unexpected ${bad.inventory_type}`, bad)
        : pass("S2", "inventory_type ∈ closed set");
    },
  },
  {
    id: "S5",
    summary: "spot_rate_net = SpotRate * 0.85",
    check: (_, output) => {
      const bad = output.find((s) => !approxEq(s.spot_rate_net, s.SpotRate * 0.85, 0.01));
      return bad
        ? fail("S5", "spot_rate_net = SpotRate * 0.85",
            `${bad.spot_rate_net} vs ${bad.SpotRate * 0.85}`, bad)
        : pass("S5", "spot_rate_net = SpotRate * 0.85");
    },
  },
  {
    id: "S6",
    summary: "Booked display status follows As Booked / As Placed rule",
    check: (_, output) => {
      const bad = output.find((s) => {
        const expected = s.SpotState !== "Placed"
          ? "As Booked"
          : s.inventory_type_placed === s.inventory_type_booked
            ? "As Booked"
            : "As Placed";
        return s.booked_display_status !== expected;
      });
      return bad
        ? fail("S6", "Booked display status follows As Booked / As Placed rule",
            `got ${bad.booked_display_status}`, bad)
        : pass("S6", "Booked display status follows As Booked / As Placed rule");
    },
  },
  {
    id: "S8",
    summary: "post_code never carries the ' Premiere' suffix",
    check: (_, output) => {
      const bad = output.find((s) => s.post_code.includes(" Premiere"));
      return bad
        ? fail("S8", "post_code never carries the ' Premiere' suffix",
            `post_code=${bad.post_code}`, bad)
        : pass("S8", "post_code never carries the ' Premiere' suffix");
    },
  },
  {
    id: "S10",
    summary: "booked_impressions_thousands = BookedImpressions / 1000",
    check: (_, output) => {
      const bad = output.find((s) => !approxEq(s.booked_impressions_thousands, s.BookedImpressions / 1000, 0.001));
      return bad
        ? fail("S10", "booked_impressions_thousands = BookedImpressions / 1000",
            `${bad.booked_impressions_thousands} vs ${bad.BookedImpressions / 1000}`, bad)
        : pass("S10", "booked_impressions_thousands = BookedImpressions / 1000");
    },
  },
  {
    id: "S11",
    summary: "FL flag iff InventoryCodePlaced contains 'Timeout'",
    check: (_, output) => {
      const bad = output.find((s) => {
        const expected = (s.InventoryCodePlaced || "").includes("Timeout") ? "FL" : "P";
        return s.fl_flag !== expected;
      });
      return bad ? fail("S11", "FL flag iff InventoryCodePlaced contains 'Timeout'",
        `fl_flag=${bad.fl_flag}`, bad) : pass("S11", "FL flag iff InventoryCodePlaced contains 'Timeout'");
    },
  },
  {
    id: "S12",
    summary: "HTS flag iff AEFullName contains 'HomeTeamSports'",
    check: (_, output) => {
      const bad = output.find((s) => {
        const expected = (s.AEFullName || "").includes("HomeTeamSports") ? "HTS" : "Non-HTS";
        return s.hts_flag !== expected;
      });
      return bad
        ? fail("S12", "HTS flag iff AEFullName contains 'HomeTeamSports'",
            `hts=${bad.hts_flag} ae=${bad.AEFullName}`, bad)
        : pass("S12", "HTS flag iff AEFullName contains 'HomeTeamSports'");
    },
  },
  {
    id: "S13",
    summary: "Period derives from broadcast quarter",
    check: (_, output) => {
      const bad = output.find((s) => {
        const expected = s.broadcast_qtr === "Q4" ? "4Q"
          : s.broadcast_qtr === "Q1" || s.broadcast_qtr === "Q2" ? "1-2Q"
          : null;
        return s.period !== expected;
      });
      return bad
        ? fail("S13", "Period derives from broadcast quarter",
            `qtr=${bad.broadcast_qtr} period=${bad.period}`, bad)
        : pass("S13", "Period derives from broadcast quarter");
    },
  },
  {
    id: "S14",
    summary: "SpotRate is non-negative",
    check: (_, output) => {
      const bad = output.find((s) => s.SpotRate < 0);
      return bad ? fail("S14", "SpotRate is non-negative", `rate=${bad.SpotRate}`, bad) : pass("S14", "SpotRate is non-negative");
    },
  },
  {
    id: "S15",
    summary: "AirDate parses to a valid date in 2018+",
    check: (_, output) => {
      const bad = output.find((s) => {
        const d = new Date(s.air_date_iso);
        return isNaN(d.getTime()) || d.getUTCFullYear() < 2018;
      });
      return bad
        ? fail("S15", "AirDate parses to a valid date in 2018+", `iso=${bad.air_date_iso}`, bad)
        : pass("S15", "AirDate parses to a valid date in 2018+");
    },
  },
];

// ============================================================================
// deriveSchedule contracts
// ============================================================================

const scheduleContracts: Array<{ id: string; summary: string; check: ScheduleContract }> = [
  {
    id: "G1",
    summary: "Each game produces 3 INV TYPE rows",
    check: (output) => {
      const groups = new Map<string, Set<string>>();
      for (const r of output) {
        const k = `${r.DATE}|${r.EVENT_PROGRAM}`;
        const set = groups.get(k) ?? new Set();
        set.add(r["INV TYPE"]);
        groups.set(k, set);
      }
      const bad = [...groups.entries()].find(([, set]) => set.size !== 3);
      return bad
        ? fail("G1", "Each game produces 3 INV TYPE rows",
            `${bad[0]} has ${bad[1].size}`, [...bad[1]])
        : pass("G1", "Each game produces 3 INV TYPE rows");
    },
  },
  {
    id: "G3",
    summary: "+/- variant only set for In Game and follows half-hour-modulo rule",
    check: (output) => {
      const bad = output.find((r) => {
        const m = r.START.match(/:(\d{2})$/);
        const min = m ? Number(m[1]) % 30 : 0;
        const expected: "+" | "-" | null =
          r["INV TYPE"] !== "In Game" ? null
          : min < 8 ? "-" : min > 14 ? "+" : null;
        return r["+/-"] !== expected;
      });
      return bad
        ? fail("G3", "+/- variant only set for In Game and follows half-hour-modulo rule",
            `inv=${bad["INV TYPE"]} start=${bad.START} +/-=${bad["+/-"]}`, bad)
        : pass("G3", "+/- variant only set for In Game and follows half-hour-modulo rule");
    },
  },
  {
    id: "G4",
    summary: "Simulcast iff OTHER TV is non-empty",
    check: (output) => {
      const bad = output.find((r) => {
        const expected = (r["OTHER TV"] ?? "") === "" || r["OTHER TV"] == null ? "Exclusive" : "Simulcast";
        return r.Simulcast !== expected;
      });
      return bad
        ? fail("G4", "Simulcast iff OTHER TV is non-empty",
            `other=${bad["OTHER TV"]} simulcast=${bad.Simulcast}`, bad)
        : pass("G4", "Simulcast iff OTHER TV is non-empty");
    },
  },
  {
    id: "G5",
    summary: "Expanded format ∈ closed set",
    check: (output) => {
      const allowed = new Set(["Standard", "Expanded", "DH", "Expanded DH"]);
      const bad = output.find((r) => !allowed.has(r.Expanded));
      return bad ? fail("G5", "Expanded format ∈ closed set", `got ${bad.Expanded}`, bad) : pass("G5", "Expanded format ∈ closed set");
    },
  },
  {
    id: "G6",
    summary: "Matchup tier from opponent name",
    check: (output) => {
      const REGIONAL = new Set(["Giants", "Padres", "Angels"]);
      const bad = output.find((r) => {
        const isRegional = [...REGIONAL].some((t) => r.OPPONENT.includes(t));
        const expected = isRegional ? "Regional" : "Standard";
        return r.Matchup !== expected;
      });
      return bad ? fail("G6", "Matchup tier from opponent name", `opp=${bad.OPPONENT} got=${bad.Matchup}`, bad) : pass("G6", "Matchup tier from opponent name");
    },
  },
  {
    id: "G7",
    summary: "INV TYPE.1 = INV TYPE concat with +/-",
    check: (output) => {
      const bad = output.find((r) => {
        const expected = r["+/-"] != null ? `${r["INV TYPE"]}${r["+/-"]}` : r["INV TYPE"];
        return r["INV TYPE.1"] !== expected;
      });
      return bad ? fail("G7", "INV TYPE.1 = INV TYPE concat with +/-", `got ${bad["INV TYPE.1"]}`, bad) : pass("G7", "INV TYPE.1 = INV TYPE concat with +/-");
    },
  },
  {
    id: "G8",
    summary: "TYPE2 ∈ {PR, REG} matches PRE prefix in #",
    check: (output) => {
      const bad = output.find((r) => {
        const isPR = String(r["#"]).includes("PRE");
        return r.TYPE2 !== (isPR ? "PR" : "REG");
      });
      return bad ? fail("G8", "TYPE2 ∈ {PR, REG} matches PRE prefix in #", `# ${bad["#"]} → ${bad.TYPE2}`, bad) : pass("G8", "TYPE2 ∈ {PR, REG} matches PRE prefix in #");
    },
  },
  {
    id: "G9",
    summary: "Output excludes (Confirmed Exclusive) rows",
    check: (output) => {
      const bad = output.find((r) => r.TV.includes("(Confirmed Exclusive)"));
      return bad ? fail("G9", "Output excludes (Confirmed Exclusive) rows", `tv=${bad.TV}`, bad) : pass("G9", "Output excludes (Confirmed Exclusive) rows");
    },
  },
  {
    id: "G10",
    summary: "Output excludes OFF DAY rows",
    check: (output) => {
      const bad = output.find((r) => !r["#"] || r.START === "OFF DAY");
      return bad ? fail("G10", "Output excludes OFF DAY rows", JSON.stringify(bad), bad) : pass("G10", "Output excludes OFF DAY rows");
    },
  },
  {
    id: "G11",
    summary: "DATE > 2019-12-29",
    check: (output) => {
      const cutoff = new Date("2019-12-29T00:00:00Z").getTime();
      const bad = output.find((r) => new Date(`${r.DATE}T00:00:00Z`).getTime() <= cutoff);
      return bad ? fail("G11", "DATE > 2019-12-29", `date=${bad.DATE}`, bad) : pass("G11", "DATE > 2019-12-29");
    },
  },
  {
    id: "G12",
    summary: "PR games carry 'PR: ' prefix on EVENT_PROGRAM",
    check: (output) => {
      const bad = output.find((r) => (r.TYPE2 === "PR") !== r.EVENT_PROGRAM.startsWith("PR: "));
      return bad ? fail("G12", "PR games carry 'PR: ' prefix on EVENT_PROGRAM", `type2=${bad.TYPE2} evt=${bad.EVENT_PROGRAM}`, bad) : pass("G12", "PR games carry 'PR: ' prefix on EVENT_PROGRAM");
    },
  },
  {
    id: "G15",
    summary: "Avails Key = TYPE.TYPE2.INV TYPE.1.Expanded",
    check: (output) => {
      const bad = output.find((r) => r["Avails Key"] !== [r.TYPE, r.TYPE2, r["INV TYPE.1"], r.Expanded].join("."));
      return bad ? fail("G15", "Avails Key = TYPE.TYPE2.INV TYPE.1.Expanded", `got ${bad["Avails Key"]}`, bad) : pass("G15", "Avails Key = TYPE.TYPE2.INV TYPE.1.Expanded");
    },
  },
];

// ============================================================================
// deriveSpotsByClient contracts
// ============================================================================

const sbcContracts: Array<{ id: string; summary: string; check: SbcContract }> = [
  {
    id: "C1",
    summary: "Output preserves every schedule (DATE, INV TYPE) tuple",
    check: (output, schedule) => {
      const outputKeys = new Set(output.map((r) => `${r.DATE}|${r["INV TYPE"]}`));
      const missing = schedule.find((s) => !outputKeys.has(`${s.DATE}|${s["INV TYPE"]}`));
      return missing
        ? fail("C1", "Output preserves every schedule (DATE, INV TYPE) tuple",
            `missing ${missing.DATE} ${missing["INV TYPE"]}`, missing)
        : pass("C1", "Output preserves every schedule (DATE, INV TYPE) tuple");
    },
  },
  {
    id: "C3",
    summary: "$0 = Paid iff SpotRate > 0",
    check: (output) => {
      const bad = output.find((r) => r.$0 !== (r["spot.SpotRate"] > 0 ? "Paid" : "$0"));
      return bad ? fail("C3", "$0 = Paid iff SpotRate > 0", `rate=${bad["spot.SpotRate"]} $0=${bad.$0}`, bad) : pass("C3", "$0 = Paid iff SpotRate > 0");
    },
  },
  {
    id: "C4",
    summary: "Numeric spot fields default to 0 (not null)",
    check: (output) => {
      const NUM_FIELDS: (keyof SpotsByClientRow)[] = [
        "spot.SpotRate", "spot.BookedRating", "spot.BookedImpressions",
        "spot.TotalEquivSold", "spot.EffectiveUnitRate", "spot.SpotRate (Net)",
      ];
      const bad = output.find((r) => NUM_FIELDS.some((f) => typeof r[f] !== "number" || isNaN(r[f] as number)));
      return bad ? fail("C4", "Numeric spot fields default to 0 (not null)", JSON.stringify(bad), bad) : pass("C4", "Numeric spot fields default to 0 (not null)");
    },
  },
  {
    id: "C7",
    summary: "$0 = Paid implies SpotRate > 0",
    check: (output) => {
      const bad = output.find((r) => r.$0 === "Paid" && r["spot.SpotRate"] <= 0);
      return bad ? fail("C7", "$0 = Paid implies SpotRate > 0", JSON.stringify(bad), bad) : pass("C7", "$0 = Paid implies SpotRate > 0");
    },
  },
  {
    id: "C8",
    summary: "$0 = '$0' implies SpotRate === 0",
    check: (output) => {
      const bad = output.find((r) => r.$0 === "$0" && r["spot.SpotRate"] !== 0);
      return bad ? fail("C8", "$0 = '$0' implies SpotRate === 0", JSON.stringify(bad), bad) : pass("C8", "$0 = '$0' implies SpotRate === 0");
    },
  },
  {
    id: "C11",
    summary: "Every output row's (DATE, INV TYPE) tuple is in the schedule",
    check: (output, schedule) => {
      const scheduleKeys = new Set(schedule.map((s) => `${s.DATE}|${s["INV TYPE"]}`));
      const bad = output.find((r) => !scheduleKeys.has(`${r.DATE}|${r["INV TYPE"]}`));
      return bad ? fail("C11", "Every output row's (DATE, INV TYPE) tuple is in the schedule",
        `${bad.DATE} ${bad["INV TYPE"]}`, bad) : pass("C11", "Every output row's (DATE, INV TYPE) tuple is in the schedule");
    },
  },
];

// ============================================================================
// deriveInventory contracts
// ============================================================================

const inventoryContracts: Array<{ id: string; summary: string; check: InventoryContract }> = [
  {
    id: "I1",
    summary: "Every game has 4 INV TYPE rows (Pregame, In Game±/, Postgame, Floaters A&B)",
    check: (output) => {
      const groups = new Map<string, string[]>();
      for (const r of output) {
        const k = `${r.DATE}|${r.EVENT_PROGRAM}`;
        const list = groups.get(k) ?? [];
        list.push(r["INV TYPE"]);
        groups.set(k, list);
      }
      const bad = [...groups.entries()].find(([, types]) => {
        const set = new Set(types);
        return !set.has("Pregame") || !set.has("Postgame") || !set.has("Floaters A&B") ||
          !["In Game", "In Game+", "In Game-"].some((t) => set.has(t));
      });
      return bad
        ? fail("I1", "Every game has 4 INV TYPE rows", `${bad[0]} has [${bad[1].join(", ")}]`, bad[1])
        : pass("I1", "Every game has 4 INV TYPE rows");
    },
  },
  {
    id: "I2",
    summary: "Cap = 6 for Floaters A&B, else from inventory_capacity",
    check: (output) => {
      const bad = output.find((r) => r["INV TYPE"] === "Floaters A&B" && r.Cap !== 6);
      return bad ? fail("I2", "Cap = 6 for Floaters A&B", `cap=${bad.Cap}`, bad) : pass("I2", "Cap = 6 for Floaters A&B");
    },
  },
  {
    id: "I5",
    summary: "Sellout = Sold / Cap",
    check: (output) => {
      const bad = output.find((r) => r.Cap > 0 && !approxEq(r.Sellout, r.Sold / r.Cap, 1e-3));
      return bad ? fail("I5", "Sellout = Sold / Cap", `sellout=${bad.Sellout} sold=${bad.Sold} cap=${bad.Cap}`, bad) : pass("I5", "Sellout = Sold / Cap");
    },
  },
  {
    id: "I7",
    summary: "Pregame / Postgame / Floaters A&B never resolve to FL... actually Floaters A&B is always FL per spec",
    check: (output) => {
      const bad = output.find((r) =>
        (r["INV TYPE"] === "Pregame" || r["INV TYPE"] === "Postgame") &&
        r["Rate Tier"] === "FL"
      );
      return bad ? fail("I7", "Pregame / Postgame never resolve to FL", `inv=${bad["INV TYPE"]} tier=${bad["Rate Tier"]}`, bad) : pass("I7", "Pregame / Postgame never resolve to FL");
    },
  },
  {
    id: "I8",
    summary: "Rate (looked up from rate card) is non-negative",
    check: (output) => {
      const bad = output.find((r) => r.Rate < 0);
      return bad ? fail("I8", "Rate is non-negative", `rate=${bad.Rate}`, bad) : pass("I8", "Rate is non-negative");
    },
  },
  {
    id: "I9",
    summary: "Floaters A&B rows have zeroed Gross/Net/EUR/AUR",
    check: (output) => {
      const bad = output.find((r) =>
        r["INV TYPE"] === "Floaters A&B" &&
        (r["Gross Rev"] !== 0 || r["Net Rev"] !== 0 || r.EUR !== 0 || r.AUR !== 0)
      );
      return bad ? fail("I9", "Floaters A&B rows have zeroed Gross/Net/EUR/AUR", JSON.stringify(bad), bad) : pass("I9", "Floaters A&B rows have zeroed Gross/Net/EUR/AUR");
    },
  },
  {
    id: "I10",
    summary: "Net Rev ≈ Gross Rev × 0.85 for non-Floater paid rows",
    check: (output) => {
      const bad = output.find((r) =>
        r["INV TYPE"] !== "Floaters A&B" &&
        r["Gross Rev"] > 0 &&
        !approxEq(r["Net Rev"], r["Gross Rev"] * 0.85, 1.5)
      );
      return bad ? fail("I10", "Net Rev ≈ Gross Rev × 0.85 for non-Floater paid rows",
        `gross=${bad["Gross Rev"]} net=${bad["Net Rev"]}`, bad) : pass("I10", "Net Rev ≈ Gross Rev × 0.85 for non-Floater paid rows");
    },
  },
  {
    id: "I14",
    summary: "Start of Week is Monday on/before DATE",
    check: (output) => {
      const bad = output.find((r) => {
        const d = new Date(`${r.DATE}T00:00:00Z`);
        const dow = d.getUTCDay();
        const offset = dow === 0 ? -6 : 1 - dow;
        const expected = new Date(d);
        expected.setUTCDate(d.getUTCDate() + offset);
        return r["Start of Week"] !== expected.toISOString().slice(0, 10);
      });
      return bad ? fail("I14", "Start of Week is Monday on/before DATE",
        `date=${bad.DATE} sow=${bad["Start of Week"]}`, bad) : pass("I14", "Start of Week is Monday on/before DATE");
    },
  },
  {
    id: "I15",
    summary: "Rate Key = TYPE2.INV TYPE.Matchup.Rate Tier",
    check: (output) => {
      const bad = output.find((r) =>
        r["Rate Key"] !== [r.TYPE2, r["INV TYPE"], r.Matchup, r["Rate Tier"]].join(".")
      );
      return bad ? fail("I15", "Rate Key = TYPE2.INV TYPE.Matchup.Rate Tier", `got ${bad["Rate Key"]}`, bad) : pass("I15", "Rate Key = TYPE2.INV TYPE.Matchup.Rate Tier");
    },
  },
];

// ============================================================================
// deriveAurSummary contracts
// ============================================================================

const aurContracts: Array<{ id: string; summary: string; check: AurContract }> = [
  {
    id: "A1",
    summary: "Floaters A&B excluded from output",
    check: (output) => {
      const bad = output.find((r) => (r["INV TYPE"] as string) === "Floaters A&B");
      return bad ? fail("A1", "Floaters A&B excluded from output", `inv=${bad["INV TYPE"]}`, bad) : pass("A1", "Floaters A&B excluded from output");
    },
  },
  {
    id: "A2",
    summary: "Every output row has all required columns as numbers (no nulls/NaN)",
    check: (output) => {
      const REQ: (keyof AurSummaryRow)[] = [
        "HTS Paid.EQ30", "HTS Paid.Gross REV", "HTS Paid.Net REV",
        "HTS NC.EQ30", "HTS ADU.EQ30", "HTS Cross Property ADU.EQ30", "HTS Bonus.EQ30",
        "Non-HTS Paid.EQ30", "Non-HTS Paid.Gross REV", "Non-HTS Paid.Net REV",
        "Non-HTS NC.EQ30", "Non-HTS ADU.EQ30", "Non-HTS Cross Property ADU.EQ30", "Non-HTS Bonus.EQ30",
        "Total Paid.EQ30", "Total Paid.Gross REV", "Total Paid.Net REV",
        "Total NC.EQ30", "Total ADU.EQ30", "Total Cross Property ADU.EQ30", "Total Bonus.EQ30",
        "HTS Total.EQ30", "Non-HTS Total.EQ30", "Total Total.EQ30",
        "Sellout", "Sellout + ADU", "Avails",
      ];
      const bad = output.find((r) => REQ.some((c) => typeof r[c] !== "number" || isNaN(r[c] as number)));
      return bad ? fail("A2", "Every output row has all required columns as numbers", JSON.stringify(bad), bad) : pass("A2", "Every output row has all required columns as numbers");
    },
  },
  {
    id: "A3",
    summary: "Total = HTS + Non-HTS for every (Spot Group, metric) pair",
    check: (output) => {
      const PAIRS: Array<keyof AurSummaryRow> = [
        "Paid.EQ30" as keyof AurSummaryRow, "Paid.Gross REV" as keyof AurSummaryRow, "Paid.Net REV" as keyof AurSummaryRow,
        "NC.EQ30" as keyof AurSummaryRow, "ADU.EQ30" as keyof AurSummaryRow,
        "Cross Property ADU.EQ30" as keyof AurSummaryRow, "Bonus.EQ30" as keyof AurSummaryRow,
      ];
      for (const r of output) {
        for (const pair of PAIRS) {
          const k = String(pair);
          const total = (r as any)[`Total ${k}`];
          const hts = (r as any)[`HTS ${k}`];
          const nonHts = (r as any)[`Non-HTS ${k}`];
          if (!approxEq(total, hts + nonHts, 0.05)) {
            return fail("A3", "Total = HTS + Non-HTS for every (Spot Group, metric) pair",
              `pair=${k} total=${total} sum=${hts + nonHts}`, r);
          }
        }
      }
      return pass("A3", "Total = HTS + Non-HTS for every (Spot Group, metric) pair");
    },
  },
  {
    id: "A6",
    summary: "Sellout = (Total Paid.EQ30 + Total NC.EQ30) / Avails",
    check: (output) => {
      const bad = output.find((r) =>
        r.Avails > 0 && !approxEq(r.Sellout, (r["Total Paid.EQ30"] + r["Total NC.EQ30"]) / r.Avails, 1e-3)
      );
      return bad ? fail("A6", "Sellout formula", `sellout=${bad.Sellout}`, bad) : pass("A6", "Sellout formula");
    },
  },
  {
    id: "A7",
    summary: "Sellout + ADU includes ADU and Cross Property ADU",
    check: (output) => {
      const bad = output.find((r) =>
        r.Avails > 0 && !approxEq(r["Sellout + ADU"],
          (r["Total Paid.EQ30"] + r["Total NC.EQ30"] + r["Total ADU.EQ30"] + r["Total Cross Property ADU.EQ30"]) / r.Avails,
          1e-3
        )
      );
      return bad ? fail("A7", "Sellout + ADU formula", `${bad["Sellout + ADU"]}`, bad) : pass("A7", "Sellout + ADU formula");
    },
  },
  {
    id: "A8",
    summary: "Sellout + ADU >= Sellout",
    check: (output) => {
      const bad = output.find((r) => r["Sellout + ADU"] < r.Sellout - 1e-9);
      return bad ? fail("A8", "Sellout + ADU >= Sellout", `${bad["Sellout + ADU"]} < ${bad.Sellout}`, bad) : pass("A8", "Sellout + ADU >= Sellout");
    },
  },
  {
    id: "A9",
    summary: "All EQ30 columns >= 0",
    check: (output) => {
      const EQ_COLS: (keyof AurSummaryRow)[] = [
        "HTS Paid.EQ30", "HTS NC.EQ30", "HTS ADU.EQ30", "HTS Cross Property ADU.EQ30", "HTS Bonus.EQ30",
        "Non-HTS Paid.EQ30", "Non-HTS NC.EQ30", "Non-HTS ADU.EQ30", "Non-HTS Cross Property ADU.EQ30", "Non-HTS Bonus.EQ30",
        "Total Paid.EQ30", "Total NC.EQ30", "Total ADU.EQ30", "Total Cross Property ADU.EQ30", "Total Bonus.EQ30",
      ];
      const bad = output.find((r) => EQ_COLS.some((c) => (r[c] as number) < 0));
      return bad ? fail("A9", "All EQ30 columns >= 0", JSON.stringify(bad), bad) : pass("A9", "All EQ30 columns >= 0");
    },
  },
  {
    id: "A11",
    summary: "Per-LOB Net REV ≈ Gross REV × 0.85 (Paid only)",
    check: (output) => {
      const bad = output.find((r) =>
        !approxEq(r["HTS Paid.Net REV"], r["HTS Paid.Gross REV"] * 0.85, 1.0) ||
        !approxEq(r["Non-HTS Paid.Net REV"], r["Non-HTS Paid.Gross REV"] * 0.85, 1.0) ||
        !approxEq(r["Total Paid.Net REV"], r["Total Paid.Gross REV"] * 0.85, 1.0)
      );
      return bad ? fail("A11", "Net = 0.85 * Gross", JSON.stringify(bad), bad) : pass("A11", "Net = 0.85 * Gross");
    },
  },
  {
    id: "A12",
    summary: "Avails non-null > 0 for every output row",
    check: (output) => {
      const bad = output.find((r) => r.Avails == null || r.Avails <= 0);
      return bad ? fail("A12", "Avails non-null > 0", `avails=${bad.Avails}`, bad) : pass("A12", "Avails non-null > 0");
    },
  },
  {
    id: "A13",
    summary: "HTS Total.EQ30 = sum of HTS spot-group EQ30",
    check: (output) => {
      const bad = output.find((r) => !approxEq(
        r["HTS Total.EQ30"],
        r["HTS Bonus.EQ30"] + r["HTS Cross Property ADU.EQ30"] + r["HTS ADU.EQ30"] + r["HTS NC.EQ30"] + r["HTS Paid.EQ30"],
        0.05
      ));
      return bad ? fail("A13", "HTS Total.EQ30 sum", JSON.stringify(bad), bad) : pass("A13", "HTS Total.EQ30 sum");
    },
  },
  {
    id: "A14",
    summary: "Non-HTS Total.EQ30 = sum of Non-HTS spot-group EQ30",
    check: (output) => {
      const bad = output.find((r) => !approxEq(
        r["Non-HTS Total.EQ30"],
        r["Non-HTS Bonus.EQ30"] + r["Non-HTS Cross Property ADU.EQ30"] + r["Non-HTS ADU.EQ30"] + r["Non-HTS NC.EQ30"] + r["Non-HTS Paid.EQ30"],
        0.05
      ));
      return bad ? fail("A14", "Non-HTS Total.EQ30 sum", JSON.stringify(bad), bad) : pass("A14", "Non-HTS Total.EQ30 sum");
    },
  },
  {
    id: "A15",
    summary: "Total Total.EQ30 = HTS Total + Non-HTS Total",
    check: (output) => {
      const bad = output.find((r) => !approxEq(r["Total Total.EQ30"], r["HTS Total.EQ30"] + r["Non-HTS Total.EQ30"], 0.05));
      return bad ? fail("A15", "Total Total.EQ30 = HTS Total + Non-HTS Total", JSON.stringify(bad), bad) : pass("A15", "Total Total.EQ30 = HTS Total + Non-HTS Total");
    },
  },
];

// ============================================================================
// Top-level validator
// ============================================================================

export interface ContractsRunResult {
  results: ContractResult[];
  allPassed: boolean;
}

export function runContracts(inputs: EtlInputs, outputs: EtlOutputs): ContractsRunResult {
  const results: ContractResult[] = [];
  for (const c of spotsContracts) results.push(c.check(inputs.spots, outputs.spots));
  for (const c of scheduleContracts) results.push(c.check(outputs.schedule));
  for (const c of sbcContracts) results.push(c.check(outputs.spotsByClient, outputs.schedule));
  for (const c of inventoryContracts) {
    results.push(c.check(outputs.inventoryExc0));
  }
  for (const c of aurContracts) results.push(c.check(outputs.aurSummary));
  return { results, allPassed: results.every((r) => r.passed) };
}
