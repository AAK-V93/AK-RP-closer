export function appUrl() {
  const nextAuth = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  if (nextAuth && !isLoopbackHost(nextAuth)) return nextAuth;
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return nextAuth || "http://localhost:3000";
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
