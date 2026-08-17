import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getPrisma } from "@/lib/prisma";

export const GUEST_COOKIE = "closer_guest";
export const FREE_DONE_COOKIE = "closer_free_done";
export const FREE_QC_DONE_COOKIE = "closer_free_qc_done";
export const FREE_USED_CODE = "FREE_USED";
export const FREE_QC_USED_CODE = "FREE_QC_USED";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const MAX_STARTS_WITHOUT_REPORT = 3;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}

export function clientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  const forwarded = request.headers.get("x-forwarded-for");
  const real = request.headers.get("x-real-ip");
  const raw = vercel || forwarded || real || "";
  const ip = raw.split(",")[0]?.trim() || "";
  if (!ip || ip === "unknown" || ip === "::1" || ip === "127.0.0.1" || ip.endsWith("127.0.0.1")) {
    return "unknown";
  }
  return ip;
}

export function hashIp(ip: string): string | null {
  if (!ip || ip === "unknown") return null;
  const salt =
    process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "closer-trainer";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function getOrCreateGuestId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(GUEST_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const id = randomBytes(16).toString("hex");
  store.set(GUEST_COOKIE, id, cookieOptions());
  return id;
}

export async function hasFreeDoneCookie(): Promise<boolean> {
  const store = await cookies();
  return store.get(FREE_DONE_COOKIE)?.value === "1";
}

export async function setFreeDoneCookie() {
  const store = await cookies();
  store.set(FREE_DONE_COOKIE, "1", cookieOptions());
}

export async function hasFreeQcDoneCookie(): Promise<boolean> {
  const store = await cookies();
  return store.get(FREE_QC_DONE_COOKIE)?.value === "1";
}

export async function setFreeQcDoneCookie() {
  const store = await cookies();
  store.set(FREE_QC_DONE_COOKIE, "1", cookieOptions());
}

export type GuestAccess = {
  allowed: boolean;
  remaining: number;
  used: boolean;
};

export async function getGuestAccess(request: Request): Promise<GuestAccess> {
  if (await hasFreeDoneCookie()) {
    return { allowed: false, remaining: 0, used: true };
  }

  const prisma = getPrisma();
  if (!prisma) {
    return { allowed: true, remaining: 1, used: false };
  }

  try {
    const guestId = await getOrCreateGuestId();
    const ipHash = hashIp(clientIp(request));

    const used = await prisma.guestFreePractice.findFirst({
      where: {
        completedAt: { not: null },
        OR: ipHash
          ? [{ cookieId: guestId }, { ipHash }]
          : [{ cookieId: guestId }],
      },
    });

    if (used) {
      await setFreeDoneCookie();
      return { allowed: false, remaining: 0, used: true };
    }

    return { allowed: true, remaining: 1, used: false };
  } catch (error) {
    console.error("guest access lookup failed", error);
    return { allowed: true, remaining: 1, used: false };
  }
}

export async function assertGuestCanStart(
  request: Request,
): Promise<{ ok: true } | { ok: false; access: GuestAccess }> {
  const access = await getGuestAccess(request);
  if (!access.allowed) return { ok: false, access };

  const prisma = getPrisma();
  if (!prisma) return { ok: true };

  try {
    const guestId = await getOrCreateGuestId();
    const ipHash = hashIp(clientIp(request)) || "none";
    const row = await prisma.guestFreePractice.findUnique({
      where: { cookieId: guestId },
    });

    if (row && !row.completedAt && row.startCount >= MAX_STARTS_WITHOUT_REPORT) {
      return {
        ok: false,
        access: { allowed: false, remaining: 0, used: true },
      };
    }

    await prisma.guestFreePractice.upsert({
      where: { cookieId: guestId },
      create: { cookieId: guestId, ipHash, startCount: 1 },
      update: {
        ipHash,
        startCount: { increment: 1 },
      },
    });
  } catch (error) {
    console.error("guest start tracking failed", error);
  }

  return { ok: true };
}

export async function markGuestPracticeCompleted(request: Request) {
  await setFreeDoneCookie();
  const prisma = getPrisma();
  if (!prisma) return;

  try {
    const guestId = await getOrCreateGuestId();
    const ipHash = hashIp(clientIp(request)) || "none";
    await prisma.guestFreePractice.upsert({
      where: { cookieId: guestId },
      create: {
        cookieId: guestId,
        ipHash,
        startCount: 1,
        completedAt: new Date(),
      },
      update: {
        ipHash,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("guest complete tracking failed", error);
  }
}

export async function getGuestQcAccess(request: Request): Promise<GuestAccess> {
  if (await hasFreeQcDoneCookie()) {
    return { allowed: false, remaining: 0, used: true };
  }

  const prisma = getPrisma();
  if (!prisma) {
    return { allowed: true, remaining: 1, used: false };
  }

  try {
    const guestId = await getOrCreateGuestId();
    const ipHash = hashIp(clientIp(request));
    const used = await prisma.guestFreePractice.findFirst({
      where: {
        qcCompletedAt: { not: null },
        OR: ipHash
          ? [{ cookieId: guestId }, { ipHash }]
          : [{ cookieId: guestId }],
      },
    });
    if (used) {
      await setFreeQcDoneCookie();
      return { allowed: false, remaining: 0, used: true };
    }
    return { allowed: true, remaining: 1, used: false };
  } catch (error) {
    console.error("guest QC access lookup failed", error);
    return { allowed: true, remaining: 1, used: false };
  }
}

export async function assertGuestCanRunQc(
  request: Request,
): Promise<{ ok: true } | { ok: false; access: GuestAccess }> {
  const access = await getGuestQcAccess(request);
  if (!access.allowed) return { ok: false, access };

  const prisma = getPrisma();
  if (!prisma) return { ok: true };

  try {
    const guestId = await getOrCreateGuestId();
    const ipHash = hashIp(clientIp(request)) || "none";
    const row = await prisma.guestFreePractice.findUnique({
      where: { cookieId: guestId },
    });
    if (row && !row.qcCompletedAt && row.qcStartCount >= MAX_STARTS_WITHOUT_REPORT) {
      return {
        ok: false,
        access: { allowed: false, remaining: 0, used: true },
      };
    }
    await prisma.guestFreePractice.upsert({
      where: { cookieId: guestId },
      create: { cookieId: guestId, ipHash, qcStartCount: 1 },
      update: { ipHash, qcStartCount: { increment: 1 } },
    });
  } catch (error) {
    console.error("guest QC start tracking failed", error);
  }

  return { ok: true };
}

export async function markGuestQcCompleted(request: Request) {
  await setFreeQcDoneCookie();
  const prisma = getPrisma();
  if (!prisma) return;

  try {
    const guestId = await getOrCreateGuestId();
    const ipHash = hashIp(clientIp(request)) || "none";
    await prisma.guestFreePractice.upsert({
      where: { cookieId: guestId },
      create: {
        cookieId: guestId,
        ipHash,
        qcStartCount: 1,
        qcCompletedAt: new Date(),
      },
      update: {
        ipHash,
        qcCompletedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("guest QC complete tracking failed", error);
  }
}
