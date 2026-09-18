import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeFathomRecordingId,
  recordingIdFromWebhookPayload,
} from "./fathom";

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
