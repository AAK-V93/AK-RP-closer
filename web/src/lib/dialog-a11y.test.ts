import assert from "node:assert/strict";
import * as React from "react";
import { test } from "node:test";
import { missingDialogLabels } from "./dialog-a11y";

function DialogTitle() {
  return null;
}
DialogTitle.displayName = "DialogTitle";

function DialogDescription() {
  return null;
}
DialogDescription.displayName = "DialogDescription";

function DialogHeader(props: { children?: React.ReactNode }) {
  return props.children as never;
}

function SheetTitle() {
  return null;
}
SheetTitle.displayName = "SheetTitle";

test("a dialog that already has a title does not get a second one", () => {
  const labels = missingDialogLabels(
    React.createElement(
      DialogHeader,
      null,
      React.createElement(DialogTitle, null, "Eliminar fila"),
      React.createElement(DialogDescription, null, "Sale de Operación."),
    ),
  );
  assert.equal(labels.title, false);
  assert.equal(labels.description, false);
});

test("a dialog without a title or description needs both", () => {
  const labels = missingDialogLabels(React.createElement("div", null, "solo contenido"));
  assert.equal(labels.title, true);
  assert.equal(labels.description, true);
});

test("a sheet title counts even when the description is missing", () => {
  const labels = missingDialogLabels(React.createElement(SheetTitle, null, "Sidebar"));
  assert.equal(labels.title, false);
  assert.equal(labels.description, true);
});
