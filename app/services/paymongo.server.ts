/**
 * PayMongo money-movement (batch transfers).
 * Uses sk_test_ for sandbox (no upgrade required) or sk_live_ after wallet enablement.
 */

export type PaymongoSourceAccount = {
  number: string;
  name: string;
  bic: string;
};

export type PaymongoTransferInput = {
  amountCentavos: number;
  currency?: string;
  purpose?: string;
  description?: string;
  referenceNumber: string;
  destination: {
    number: string;
    name: string;
    bic: string;
  };
  callbackUrl?: string;
  metadata?: Record<string, string>;
};

export type PaymongoTransferResult = {
  batchId: string;
  transferId: string;
  status: string;
  raw: unknown;
};

function secretKey(): string | null {
  const key = (process.env.PAYMONGO_SECRET_KEY || "").trim();
  return key || null;
}

export function isPaymongoConfigured(): boolean {
  return Boolean(secretKey());
}

export function isPaymongoAutoPayoutsEnabled(): boolean {
  const flag = (process.env.PAYMONGO_AUTO_PAYOUTS || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function authHeader(): string {
  const key = secretKey();
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not set.");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function paymongoFetch<T>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }
  if (init?.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  const res = await fetch(`https://api.paymongo.com${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const errMsg =
      (json as { errors?: Array<{ detail?: string }> })?.errors?.[0]?.detail ||
      (json as { error?: { message?: string } })?.error?.message ||
      `PayMongo HTTP ${res.status}`;
    const error = new Error(errMsg) as Error & { status?: number; body?: unknown };
    error.status = res.status;
    error.body = json;
    throw error;
  }

  return json as T;
}

export function resolveSourceAccountFromEnv(): PaymongoSourceAccount | null {
  const number = (process.env.PAYMONGO_SOURCE_ACCOUNT_NUMBER || "").trim();
  const name = (process.env.PAYMONGO_SOURCE_ACCOUNT_NAME || "").trim();
  const bic = (process.env.PAYMONGO_SOURCE_ACCOUNT_BIC || "").trim();
  if (number && name && bic) {
    return { number, name, bic };
  }
  return null;
}

type WalletListResponse = {
  data?: Array<{
    id: string;
    attributes?: {
      available_balance?: number;
      accounts?: Array<{ number?: string; name?: string; bic?: string }>;
    };
    // v2 shape may nest differently
    available_balance?: number;
    accounts?: Array<{ number?: string; name?: string; bic?: string }>;
  }>;
};

/** Prefer env source account; else first account on configured (or first) wallet. */
export async function resolveSourceAccount(): Promise<PaymongoSourceAccount> {
  const fromEnv = resolveSourceAccountFromEnv();
  if (fromEnv) return fromEnv;

  const wallets = await paymongoFetch<WalletListResponse>("/v2/wallets");
  const wantId = (process.env.PAYMONGO_SOURCE_WALLET_ID || "").trim();
  const list = wallets.data || [];
  const wallet =
    (wantId ? list.find((w) => w.id === wantId) : null) || list[0];
  if (!wallet) {
    throw new Error(
      "No PayMongo wallet found. Set PAYMONGO_SOURCE_ACCOUNT_* or PAYMONGO_SOURCE_WALLET_ID.",
    );
  }

  const accounts =
    wallet.attributes?.accounts || wallet.accounts || [];
  const account = accounts[0];
  if (!account?.number || !account?.name || !account?.bic) {
    throw new Error(
      "PayMongo wallet has no source account. Set PAYMONGO_SOURCE_ACCOUNT_NUMBER/NAME/BIC.",
    );
  }

  return {
    number: String(account.number),
    name: String(account.name),
    bic: String(account.bic),
  };
}

type BatchTransferResponse = {
  data?: {
    id?: string;
    transfers?: Array<{
      id?: string;
      status?: string;
      batch_transfer_id?: string;
    }>;
  };
};

export async function createBatchTransfer(
  transfer: PaymongoTransferInput,
  opts?: { idempotencyKey?: string },
): Promise<PaymongoTransferResult> {
  const source = await resolveSourceAccount();
  const callbackUrl =
    transfer.callbackUrl ||
    (() => {
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      return base ? `${base}/webhooks/paymongo` : undefined;
    })();

  const body = {
    transfers: [
      {
        provider: "instapay",
        amount: transfer.amountCentavos,
        currency: transfer.currency || "PHP",
        purpose: transfer.purpose || "Disbursement",
        description: transfer.description || "Seller payout",
        reference_number: transfer.referenceNumber,
        source_account: source,
        destination_account: {
          number: transfer.destination.number,
          name: transfer.destination.name,
          bic: transfer.destination.bic,
        },
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        ...(transfer.metadata ? { metadata: transfer.metadata } : {}),
      },
    ],
  };

  const json = await paymongoFetch<BatchTransferResponse>("/v2/batch_transfers", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: opts?.idempotencyKey,
  });

  const batchId = json.data?.id || "";
  const first = json.data?.transfers?.[0];
  const transferId = first?.id || "";
  if (!batchId || !transferId) {
    throw new Error("PayMongo batch transfer response missing ids.");
  }

  return {
    batchId,
    transferId,
    status: first?.status || "pending",
    raw: json,
  };
}

export function pesosToCentavos(amount: number): number {
  return Math.round(amount * 100);
}
