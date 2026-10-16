/**
 * PayMongo money-movement (batch transfers).
 * Uses sk_test_ for sandbox or sk_live_ after wallet enablement.
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

type WalletRow = {
  id: string;
  livemode?: boolean;
  status?: string;
  is_default?: boolean;
  account?: {
    provider?: string;
    account_name?: string;
    account_number?: string;
    currency?: string;
  };
  attributes?: {
    status?: string;
    livemode?: boolean;
    account?: {
      account_name?: string;
      account_number?: string;
      name?: string;
      number?: string;
      bic?: string;
    };
  };
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

export function isPaymongoTestMode(): boolean {
  const key = secretKey() || "";
  return key.startsWith("sk_test_");
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
      (json as { errors?: Array<{ detail?: string; code?: string }> })
        ?.errors?.[0]?.detail ||
      (json as { error?: { message?: string } })?.error?.message ||
      `PayMongo HTTP ${res.status}`;
    const error = new Error(errMsg) as Error & {
      status?: number;
      body?: unknown;
    };
    error.status = res.status;
    error.body = json;
    throw error;
  }

  return json as T;
}

export function resolveSourceAccountFromEnv(): PaymongoSourceAccount | null {
  const number = (process.env.PAYMONGO_SOURCE_ACCOUNT_NUMBER || "").trim();
  const name = (process.env.PAYMONGO_SOURCE_ACCOUNT_NAME || "").trim();
  const bic = (process.env.PAYMONGO_SOURCE_ACCOUNT_BIC || "").trim() || "PAEYPHM2XXX";
  if (number && name) {
    return { number, name, bic };
  }
  return null;
}

function accountFromWallet(wallet: WalletRow): PaymongoSourceAccount | null {
  const acc = wallet.account || wallet.attributes?.account;
  if (!acc) return null;
  const number =
    ("account_number" in acc && acc.account_number) ||
    ("number" in acc && (acc as { number?: string }).number) ||
    null;
  const name =
    ("account_name" in acc && acc.account_name) ||
    ("name" in acc && (acc as { name?: string }).name) ||
    null;
  if (!number || !name) return null;
  return {
    number: String(number).trim(),
    name: String(name).trim(),
    bic: String(
      ("bic" in acc && (acc as { bic?: string }).bic) || "PAEYPHM2XXX",
    ),
  };
}

/** List wallets for the current secret key (test key → test wallets only). */
export async function listPaymongoWallets(): Promise<
  Array<{
    id: string;
    status: string;
    livemode: boolean;
    account: PaymongoSourceAccount | null;
  }>
> {
  // Prefer activated; if empty, try without filter (some accounts only list default).
  const paths = [
    "/v2/wallets?status=activated&fields=account&fields=balance",
    "/v2/wallets?fields=account&fields=balance",
    "/v2/wallets",
  ];

  let list: WalletRow[] = [];
  for (const path of paths) {
    try {
      const res = await paymongoFetch<{ data?: WalletRow[] }>(path);
      list = res.data || [];
      if (list.length) break;
    } catch {
      // try next shape
    }
  }

  return list.map((w) => ({
    id: w.id,
    status: w.status || w.attributes?.status || "unknown",
    livemode: Boolean(w.livemode ?? w.attributes?.livemode),
    account: accountFromWallet(w),
  }));
}

/**
 * Resolve source account:
 * 1) Wallet returned by PayMongo API for this key (most reliable)
 * 2) Env PAYMONGO_SOURCE_ACCOUNT_* fallback
 */
export async function resolveSourceAccount(): Promise<PaymongoSourceAccount> {
  const wantId = (process.env.PAYMONGO_SOURCE_WALLET_ID || "").trim();
  const testMode = isPaymongoTestMode();

  try {
    const wallets = await listPaymongoWallets();
    const preferred =
      (wantId ? wallets.find((w) => w.id === wantId) : null) ||
      wallets.find(
        (w) =>
          w.account &&
          w.livemode === !testMode &&
          w.status !== "deactivated",
      ) ||
      wallets.find((w) => w.account && w.livemode === !testMode) ||
      wallets.find((w) => w.account && w.status !== "deactivated") ||
      wallets.find((w) => w.account);

    if (preferred?.account) {
      return preferred.account;
    }
  } catch (error) {
    console.error("PayMongo list wallets failed", error);
  }

  const fromEnv = resolveSourceAccountFromEnv();
  if (fromEnv) return fromEnv;

  throw new Error(
    testMode
      ? "No PayMongo TEST wallet found for sk_test_. In the dashboard switch to Test mode → Money Movement → Wallets. If empty, activate a wallet first."
      : "No PayMongo LIVE wallet found. Activate/enable a wallet, then retry.",
  );
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
        source_account: {
          number: source.number,
          name: source.name,
          bic: source.bic || "PAEYPHM2XXX",
        },
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

  try {
    const json = await paymongoFetch<BatchTransferResponse>(
      "/v2/batch_transfers",
      {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey: opts?.idempotencyKey,
      },
    );

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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/source account|wallet by params|GetByParams/i.test(msg)) {
      const mode = isPaymongoTestMode() ? "TEST (sk_test_)" : "LIVE (sk_live_)";
      throw new Error(
        `${msg} — PayMongo could not match source wallet for ${mode}. ` +
          `Open dashboard in the SAME mode → Wallets, confirm wallet is activated (not closed-loop), ` +
          `and that Railway PAYMONGO_SECRET_KEY matches that mode. ` +
          `Using source ${source.number} / ${source.name}.`,
      );
    }
    throw error;
  }
}

export function pesosToCentavos(amount: number): number {
  return Math.round(amount * 100);
}
