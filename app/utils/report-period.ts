export type ReportPeriod = "daily" | "weekly" | "monthly" | "yearly";

export const REPORT_PERIODS: Array<{ id: ReportPeriod; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

export function parseReportPeriod(value: string | null | undefined): ReportPeriod {
  const v = String(value || "").toLowerCase();
  if (v === "weekly" || v === "monthly" || v === "yearly") return v;
  return "daily";
}

/** Inclusive start / exclusive end for the selected period (local shop time ≈ server local). */
export function getReportPeriodRange(
  period: ReportPeriod,
  now = new Date(),
): { start: Date; end: Date; label: string } {
  const end = new Date(now);
  const start = new Date(now);

  if (period === "daily") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "weekly") {
    const day = start.getDay(); // 0 Sun … 6 Sat
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    start.setHours(0, 0, 0, 0);
  } else if (period === "monthly") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }

  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const label =
    period === "daily"
      ? fmt.format(start)
      : `${fmt.format(start)} – ${fmt.format(end)}`;

  return { start, end, label };
}

/** Shopify search syntax for created_at windows. */
export function shopifyCreatedAtQuery(start: Date, end: Date): string {
  return `created_at:>='${start.toISOString()}' created_at:<='${end.toISOString()}'`;
}
