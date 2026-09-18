export function appUrl() {
  const nextAuth = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  if (nextAuth && !isLoopbackHost(nextAuth)) return nextAuth;
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return nextAuth || "http://localhost:3000";
}

export function requestOrigin(request: Request) {
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return appUrl();
  }
}

export function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(value: string) {
  return /localhost|127\.0\.0\.1/i.test(value);
}
