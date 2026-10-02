import assert from "node:assert/strict";
import { test } from "node:test";
import {
  duplicatePasteMessage,
  duplicateReason,
  fingerprintCall,
  fingerprintPaste,
  transcriptHash,
} from "./paste-identity";

const pasted = `Llamada de venta 30/09/2026
Lead: Carlos Ramírez (QA)
Hola, te cuento la oferta.`;

test("the same transcript is the same hash after whitespace changes", () => {
  assert.equal(transcriptHash(pasted), transcriptHash(`${pasted}  \n`));
  assert.notEqual(transcriptHash(pasted), transcriptHash(`${pasted}\nOtra frase.`));
});

test("a re-paste of Carlos Ramírez (QA) matches the existing call by lead and day", () => {
  const now = new Date("2026-10-02T15:00:00.000Z");
  const incoming = fingerprintPaste(pasted, now);
  assert.equal(incoming.leadKey, "carlos ramirez");
  assert.equal(incoming.day, "2026-09-30");
  const stored = fingerprintCall({
    leadName: "Carlos Ramírez",
    recordedAt: new Date("2026-09-30T17:00:00.000Z"),
    filingJson: { telefono: "+57 300 123 4567", email: "Carlos@Example.com" },
  });
  assert.equal(stored.leadKey, incoming.leadKey);
  assert.equal(duplicateReason(incoming, { ...incoming, leadKey: "otra" }), "hash");
  assert.equal(
    duplicateReason({ ...incoming, hash: "nuevo" }, { ...stored, hash: "viejo" }),
    "lead-date",
  );
  assert.equal(
    duplicateReason(
      { ...incoming, hash: "nuevo", leadKey: "", day: stored.day, phone: stored.phone },
      { ...stored, hash: "viejo" },
    ),
    "contact-date",
  );
  assert.equal(
    duplicateReason(
      { ...incoming, hash: "nuevo", leadKey: "andrea quispe" },
      { ...stored, hash: "viejo" },
    ),
    "",
  );
  assert.equal(duplicatePasteMessage("hash", incoming), "Esta transcripción ya estaba. No creé otra fila.");
  assert.match(duplicatePasteMessage("lead-date", incoming), /Ya hay una llamada de Carlos Ramírez el .+ No creé otra fila\./);
});
