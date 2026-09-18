import assert from "node:assert/strict";
import { test } from "node:test";
import {
  meetingFromWebhookPayload,
  normalizeFathomRecordingId,
  recordingIdFromWebhookPayload,
} from "./fathom";
import { isGenericMeetingTitle } from "./fathom-import";
import {
  fathomTranscriptToText,
  normalizeFathomTranscriptItems,
} from "./fathom-transcript";
import { parseCallTranscript } from "./parse-transcript";

test("normalizeFathomRecordingId keeps large ids as text", () => {
  assert.equal(normalizeFathomRecordingId(123456789), "123456789");
  assert.equal(normalizeFathomRecordingId("9876543210123"), "9876543210123");
  assert.equal(normalizeFathomRecordingId(null), "");
  assert.equal(normalizeFathomRecordingId(0), "");
});

test("webhook payload accepts string or number recording_id", () => {
  assert.equal(
    recordingIdFromWebhookPayload({ recording_id: 746128394821 }),
    "746128394821",
  );
  assert.equal(
    recordingIdFromWebhookPayload({ meeting: { recording_id: "88" } }),
    "88",
  );
});

test("Impromptu titles stay importable; they only drop the product hint", () => {
  assert.equal(isGenericMeetingTitle("Impromptu Google Meet Meeting"), true);
  assert.equal(isGenericMeetingTitle("Karen · Círculo Millonario"), false);
});

test("normalizeFathomTranscriptItems unwraps Fathom payload shapes", () => {
  const wrapped = normalizeFathomTranscriptItems({
    transcript: [
      {
        speaker: { display_name: "Alina" },
        text: "Hola, ¿cómo estás?",
        timestamp: "0:01",
      },
      { speaker_name: "Lead", content: "Bien, cuéntame del programa.", ts: "0:08" },
    ],
  });
  assert.equal(wrapped.length, 2);
  assert.equal(wrapped[0]?.speaker?.display_name, "Alina");
  assert.match(fathomTranscriptToText(wrapped, "Impromptu Google Meet Meeting"), /Alina: Hola/);

  const nested = normalizeFathomTranscriptItems({
    data: { items: [{ speaker: "Closer", utterance: "¿Cuál es el problema?" }] },
  });
  assert.equal(nested[0]?.text, "¿Cuál es el problema?");
});

test("parseCallTranscript keeps unstructured Fathom dumps instead of dropping them", () => {
  const raw = `Impromptu Google Meet Meeting
Hola Leonardo gracias por entrar hoy quería platicar del programa de consultoría y cómo lo están estructurando en la empresa.
Claro Alina dime qué necesitamos para arrancar y de cuánto es la inversión.`;
  const parsed = parseCallTranscript(raw);
  assert.ok(parsed.lines.length >= 1);
  assert.match(parsed.lines.map((line) => line.text).join(" "), /Leonardo/);
  assert.match(parsed.lines.map((line) => line.text).join(" "), /inversión/);
});

test("parseCallTranscript reads Fathom [ts] Speaker: text lines", () => {
  const raw = `Impromptu Google Meet Meeting

[00:00:01] Alina: Hola, gracias por entrar.
[00:00:08] José: Hola, quería ver lo del programa de consultoría.
[00:01:12] Alina: Cuéntame qué te está costando hoy.`;
  const parsed = parseCallTranscript(raw);
  assert.equal(parsed.lines.length, 3);
  assert.equal(parsed.lines[0]?.speaker, "Alina");
  assert.match(parsed.lines[1]?.text || "", /consultoría/);
  assert.equal(parsed.lines[2]?.speaker, "Alina");
});

test("webhook meeting keeps transcript items from nested payload", () => {
  const meeting = meetingFromWebhookPayload({
    recording_id: "99",
    meeting: {
      title: "Impromptu Google Meet Meeting",
      transcript: [{ speaker: { display_name: "A" }, text: "hola" }],
    },
  });
  assert.equal(meeting?.recording_id, "99");
  assert.equal(meeting?.transcript?.length, 1);
});
