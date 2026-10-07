export type ReportPeriod = "daily" | "weekly" | "monthly" | "yearly";

/** Labels aligned with Shopify Admin analytics ranges. */
export const REPORT_PERIODS: Array<{ id: ReportPeriod; label: string }> = [
  { id: "daily", label: "Today" },
  { id: "weekly", label: "Last 7 days" },
  { id: "monthly", label: "Last 30 days" },
  { id: "yearly", label: "Last 12 months" },
];

export function parseReportPeriod(value: string | null | undefined): ReportPeriod {
  const v = String(value || "").toLowerCase();
  if (v === "weekly" || v === "monthly" || v === "yearly") return v;
  return "daily";
}

/** Inclusive start / end for DB attribution fallbacks. */
export function getReportPeriodRange(
  period: ReportPeriod,
  now = new Date(),
): { start: Date; end: Date; label: string } {
  const end = new Date(now);
  const start = new Date(now);

  if (period === "daily") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "weekly") {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (period === "monthly") {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setFullYear(start.getFullYear() - 1);
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

/** ShopifyQL time window + timeseries grain (Shopify Admin–style). */
export function shopifyqlPeriodClause(period: ReportPeriod): {
  since: string;
  timeseries: "hour" | "day" | "month";
  label: string;
} {
  if (period === "daily") {
    return { since: "DURING today", timeseries: "hour", label: "Today" };
  }
  if (period === "weekly") {
    return { since: "SINCE -7d", timeseries: "day", label: "Last 7 days" };
  }
  if (period === "monthly") {
    return { since: "SINCE -30d", timeseries: "day", label: "Last 30 days" };
  }
  return { since: "SINCE -12m", timeseries: "month", label: "Last 12 months" };
}

/** Shopify search syntax for created_at windows. */
export function shopifyCreatedAtQuery(start: Date, end: Date): string {
  return `created_at:>='${start.toISOString()}' created_at:<='${end.toISOString()}'`;
}
