/** Common PayMongo InstaPay receiving institutions (BIC → label). */
export const PAYMONGO_INSTITUTIONS = [
  { bic: "GXCHPHM2XXX", label: "GCash", method: "gcash" },
  { bic: "PAPHPHM1XXX", label: "Maya", method: "other" },
  { bic: "BOPIPHMM", label: "Bank of the Philippine Islands (BPI)", method: "bank" },
  { bic: "BDOCPHMM", label: "BDO Unibank", method: "bank" },
  { bic: "MBTCPHMM", label: "Metrobank", method: "bank" },
  { bic: "UBPHPHMM", label: "UnionBank", method: "bank" },
  { bic: "LBPSPHMM", label: "Land Bank of the Philippines", method: "bank" },
  { bic: "PNBMPHMM", label: "PNB", method: "bank" },
  { bic: "RCBCPHMM", label: "RCBC", method: "bank" },
  { bic: "SETCPHMM", label: "Security Bank", method: "bank" },
  { bic: "CHBKPHMM", label: "China Bank", method: "bank" },
  { bic: "EWBCPHMM", label: "EastWest Bank", method: "bank" },
  { bic: "AUBKPHMM", label: "Asia United Bank", method: "bank" },
  { bic: "BNORPHMM", label: "BDO Network Bank / test", method: "bank" },
] as const;

export function institutionLabel(bic: string | null | undefined): string | null {
  if (!bic) return null;
  return PAYMONGO_INSTITUTIONS.find((i) => i.bic === bic)?.label || bic;
}

export function defaultBicForMethod(method: string | null | undefined): string | null {
  if (method === "gcash") return "GXCHPHM2XXX";
  return null;
}
