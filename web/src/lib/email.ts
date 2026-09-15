type SendArgs = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && alertFromAddress());
}

function alertFromAddress() {
  return process.env.ALERT_FROM_EMAIL || process.env.EMAIL_FROM || "";
}

export async function sendEmail(args: SendArgs) {
  const key = process.env.RESEND_API_KEY;
  const from = alertFromAddress();
  if (!key || !from) {
    return { ok: false as const, skipped: true as const };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 400) || "Resend error");
  }
  return { ok: true as const, skipped: false as const };
}
