import { defaultBicForMethod } from "../constants/paymongo-institutions";

export function normalizePayoutAccountName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Normalize PH mobile / GCash numbers to 09XXXXXXXXX. */
export function normalizePayoutAccountNumber(
  method: string | null | undefined,
  raw: string,
): string {
  const trimmed = raw.trim();
  if (method !== "gcash") {
    return trimmed.replace(/\s+/g, "");
  }

  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("63")) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.length === 10 && digits.startsWith("9")) {
    digits = `0${digits}`;
  }
  return digits;
}

export function validateGcashNumberForInstapay(number: string): string | null {
  if (!/^09\d{9}$/.test(number)) {
    return "GCash number must be 11 digits starting with 09 (example: 09171234567).";
  }
  return null;
}

export function resolvePaymongoDestination(vendor: {
  payoutMethod?: string | null;
  payoutAccountName?: string | null;
  payoutAccountNumber?: string | null;
  payoutBankBic?: string | null;
}): { number: string; name: string; bic: string; method: string } {
  const method = (vendor.payoutMethod || "").trim().toLowerCase();
  const name = normalizePayoutAccountName(vendor.payoutAccountName || "");
  const number = normalizePayoutAccountNumber(method, vendor.payoutAccountNumber || "");
  let bic = (vendor.payoutBankBic || "").trim().toUpperCase();
  if (method === "gcash") {
    bic = defaultBicForMethod("gcash") || "GXCHPHM2XXX";
  }
  return { number, name, bic, method };
}

export function assertPaymongoDestinationReady(vendor: {
  payoutMethod?: string | null;
  payoutAccountName?: string | null;
  payoutAccountNumber?: string | null;
  payoutBankBic?: string | null;
}): { number: string; name: string; bic: string } {
  const dest = resolvePaymongoDestination(vendor);
  if (!dest.name) {
    throw new Error("Seller account name is required (must match GCash or bank records exactly).");
  }
  if (!dest.number) {
    throw new Error("Seller account number is required.");
  }
  if (!dest.bic) {
    throw new Error("Seller bank / e-wallet (BIC) is required.");
  }
  if (dest.method === "gcash") {
    const gcashErr = validateGcashNumberForInstapay(dest.number);
    if (gcashErr) {
      throw new Error(gcashErr);
    }
    if (dest.name.split(/\s+/).length < 2) {
      throw new Error(
        "GCash account name should be your full legal name as shown in the GCash app (Profile), not a nickname.",
      );
    }
  }
  return dest;
}
