/** Click-to-chat. No Twilio: abre WhatsApp con el texto listo. */
export function whatsappClickHref(phone: string, text: string) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  const q = `text=${encodeURIComponent(text.slice(0, 2000))}`;
  return digits
    ? `https://wa.me/${digits}?${q}`
    : `https://wa.me/?${q}`;
}
