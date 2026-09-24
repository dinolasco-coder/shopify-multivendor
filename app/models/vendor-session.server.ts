import { createHash, randomBytes } from "crypto";
import prisma from "../db.server";
import { VENDOR_SESSION_DAYS } from "../constants";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createVendorSession(vendorId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + VENDOR_SESSION_DAYS);

  await prisma.vendorSession.create({
    data: {
      vendorId,
      token: hashToken(rawToken),
      expiresAt,
    },
  });

  return { token: rawToken, expiresAt };
}

export async function getVendorFromSessionToken(token: string | null) {
  if (!token) return null;

  const session = await prisma.vendorSession.findUnique({
    where: { token: hashToken(token) },
    include: { vendor: true },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.vendorSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.vendor;
}

export async function destroyVendorSession(token: string | null) {
  if (!token) return;
  await prisma.vendorSession
    .deleteMany({ where: { token: hashToken(token) } })
    .catch(() => {});
}
