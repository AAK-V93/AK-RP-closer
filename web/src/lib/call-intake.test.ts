import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCallIntake,
  isInternalMeetingTitle,
  isRealTranscript,
  shouldKeepCalendarEvent,
} from "./call-intake";

test("internal titles are filtered before the extractor", () => {
  assert.equal(isInternalMeetingTitle("Standup equipo"), true);
  assert.equal(isInternalMeetingTitle("1:1 con Tita"), true);
  assert.equal(isInternalMeetingTitle("Cierre Mentoría Ana"), false);
});

test("calendar metadata is not a real transcript", () => {
  const blob = `Impromptu Google Meet Meeting
Join with Google Meet
https://meet.google.com/abc-defg-hij
hangoutLink: https://meet.google.com/abc-defg-hij
Event start: 2026-09-17T15:00:00-05:00`;
  assert.equal(isRealTranscript(blob), false);
  const decision = classifyCallIntake({
    title: "Impromptu Google Meet Meeting",
    transcript: blob,
    durationMs: 60_000,
  });
  assert.equal(decision.action, "skip");
});

test("spoken dialogue with duration goes to the extractor", () => {
  const transcript = `[00:00] Closer: Hola Ana, ¿cómo estás?
[00:12] Ana: Bien, te escuché por el anuncio de la mentoría.
[08:40] Closer: El programa sale 4800 y la reserva es 1300.
[12:10] Ana: Lo voy a pensar y te escribo el jueves.`;
  const decision = classifyCallIntake({
    title: "Cierre Ana",
    transcript,
  });
  assert.equal(decision.action, "extract");
});

test("short meetings are skipped even with talk", () => {
  const transcript = `[00:00] Closer: ¿Me escuchas?
[00:20] Lead: Sí, te llamo en cinco.
[01:10] Closer: Dale, hablamos.`;
  const decision = classifyCallIntake({
    title: "Ping",
    transcript,
    durationMs: 90_000,
  });
  assert.equal(decision.action, "skip");
  if (decision.action === "skip") assert.equal(decision.reason, "short");
});

test("calendar keeps timed Meet with an external attendee", () => {
  const keep = shouldKeepCalendarEvent({
    title: "Impromptu Google Meet Meeting",
    durationMs: 40 * 60 * 1000,
    attendees: [{ displayName: "Ana Pérez", email: "ana@cliente.com" }],
  });
  assert.equal(keep.keep, true);
  if (keep.keep) assert.equal(keep.leadName, "Ana Pérez");
});

test("calendar drops standup and generic Impromptu without guests", () => {
  assert.equal(
    shouldKeepCalendarEvent({
      title: "Standup",
      durationMs: 15 * 60 * 1000,
    }).keep,
    false,
  );
  assert.equal(
    shouldKeepCalendarEvent({
      title: "Impromptu Google Meet Meeting",
      durationMs: 20 * 60 * 1000,
      attendees: [{ self: true, displayName: "Closer" }],
    }).keep,
    false,
  );
});
