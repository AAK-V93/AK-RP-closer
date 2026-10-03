import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("button, input, and select stay 44px until the lg breakpoint", () => {
  const button = source("../components/ui/button.tsx");
  assert.match(button, /sm: "h-11 min-w-11 px-2 py-1 text-xs font-semibold lg:h-7"/);
  assert.match(button, /icon: "h-11 w-11 lg:h-7 lg:w-8"/);
  assert.equal(button.includes("md:h-7"), false);
  assert.equal(button.includes("md:w-8"), false);

  const input = source("../components/ui/input.tsx");
  assert.match(input, /h-11 min-h-11/);
  assert.match(input, /lg:h-8 lg:min-h-0/);
  assert.equal(input.includes("md:h-8"), false);

  const select = source("../components/ui/select.tsx");
  assert.match(select, /sm: 'h-11 min-h-11 min-w-11 text-xs lg:h-7 lg:min-h-0'/);
  assert.equal(select.includes("sm: 'h-7"), false);
});

test("main menu pills and Llamadas and Coach pills are at least 44px", () => {
  const shell = source("../components/app-shell.tsx");
  const menuPills = shell.match(/min-h-\[44px\]/g) ?? [];
  assert.equal(menuPills.length >= 3, true);
  assert.match(shell, /hidden md:flex/);
  assert.match(shell, /inline-flex h-11 min-h-\[44px\]/);

  const llamadas = source("../app/llamadas/page.tsx");
  assert.match(llamadas, /lg:h-8 lg:min-h-0/);
  assert.equal(llamadas.includes("md:h-8"), false);
  assert.match(llamadas, /className="min-h-11"/);

  const coach = source("../app/coach/page.tsx");
  assert.match(coach, /className="min-h-11"/);
  assert.match(coach, /inline-flex min-h-11 items-center/);
  const deleteButton = source("../components/delete-analysis-button.tsx");
  assert.match(deleteButton, /size=\{iconOnly \? "icon" : "sm"\}/);
});

test("CRM offer chips and the coach trash icon do not shrink at tablet width", () => {
  const crm = source("../app/crm/page.tsx");
  assert.match(crm, /h-auto min-h-11 max-w-full whitespace-normal text-left lg:min-h-0/);
  assert.match(crm, /h-11 min-h-11 w-full px-0\.5 text-\[11px\] lg:h-8 lg:min-h-0/);
  assert.equal(crm.includes('className="h-8 '), false);
  assert.match(crm, /block text-sm text-fg3">Nombre/);
  assert.match(crm, /placeholder="Buscar"[\s\S]{0,180}lg:h-11 lg:min-h-11/);
});
