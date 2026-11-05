/** Normalize PayMongo transfer callback / webhook JSON (several shapes). */
export function parsePaymongoTransferCallback(body: unknown): {
  transferId: string | null;
  status: string | null;
  failureMessage: string | null;
} {
  const root = body as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  const attrs = (data?.attributes ?? {}) as Record<string, unknown>;

  const transferIdRaw =
    attrs.transfer_id ||
    attrs.transferId ||
    data?.id ||
    root.id ||
    root.transfer_id ||
    root.transferId;
  const transferId = transferIdRaw ? String(transferIdRaw).trim() : null;

  const statusRaw =
    attrs.status || data?.status || root.status || root.transfer_status;
  const status = statusRaw ? String(statusRaw).trim().toLowerCase() : null;

  const parts = [
    attrs.provider_error,
    attrs.provider_error_code,
    attrs.failure_message,
    attrs.failure_code,
    root.failure_message,
    root.provider_error,
  ]
    .filter((v) => v != null && String(v).trim() !== "")
    .map((v) => String(v).trim());

  let failureMessage = parts.length ? [...new Set(parts)].join(" — ") : null;
  if (
    !failureMessage &&
    status &&
    (status === "failed" ||
      status === "cancelled" ||
      status === "canceled")
  ) {
    failureMessage =
      "Transfer failed at the recipient bank or e-wallet (InstaPay). Verify GCash account name and mobile number match the registered profile.";
  }

  return { transferId, status, failureMessage };
}
