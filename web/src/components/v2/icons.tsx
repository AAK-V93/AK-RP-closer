// Icons from the v2 mockups (render.py), stroke style.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconPlus = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCheck = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} strokeWidth={2.4} aria-hidden><path d="M5 12l5 5L20 7" /></svg>
);
export const IconChev = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
);
export const IconPen = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
);
export const IconUpload = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 17v3h16v-3" /></svg>
);
export const IconPhone = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
export const IconFlag = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
);
export const IconCal = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const IconPeople = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden>
    <circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.6" />
  </svg>
);
export const IconInfo = () => (
  <svg className="ic" viewBox="0 0 24 24" {...S} aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
);
