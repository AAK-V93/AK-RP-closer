import assert from "node:assert/strict";
import * as React from "react";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BibliotecaPackList } from "../app/biblioteca/pack-list";
import { RouteError } from "../components/route-error";
import { normalizeLibraryPayload } from "./library-pack";

test("biblioteca normalizes an empty payload and a pack missing tags", () => {
  const empty = normalizeLibraryPayload({});
  assert.deepEqual(empty, { packs: [], offers: [] });

  const wrapped = normalizeLibraryPayload({
    packs: { items: [{ id: "suelto", title: "Sin tags" }] },
    offers: { items: [{ id: "oferta-1", productName: "Norte" }] },
  });
  assert.equal(wrapped.packs.length, 1);
  assert.deepEqual(wrapped.packs[0]?.tags, []);
  assert.deepEqual(wrapped.packs[0]?.items, []);
  assert.equal(wrapped.offers[0]?.productName, "Norte");

  const tagged = normalizeLibraryPayload({
    packs: [{ id: "csv", title: "Con tags", tags: "cobro, whatsapp", items: null }],
    offers: [],
  });
  assert.deepEqual(tagged.packs[0]?.tags, ["cobro", "whatsapp"]);
  assert.deepEqual(tagged.packs[0]?.items, []);
});

test("biblioteca renders an empty library and a pack without tags or items", () => {
  const emptyHtml = renderToStaticMarkup(
    React.createElement(BibliotecaPackList, {
      packs: normalizeLibraryPayload({ packs: [], offers: [] }).packs,
      offers: [],
      onPost: async () => undefined,
    }),
  );
  assert.match(emptyHtml, /Todavía no hay packs/);
  assert.doesNotMatch(emptyHtml, /Application error/);

  const partial = {
    id: "suelto",
    title: "Pack suelto",
    description: "Sin campos de lista",
  };
  const html = renderToStaticMarkup(
    React.createElement(BibliotecaPackList, {
      packs: [partial as never],
      offers: undefined as never,
      initialOpenId: "suelto",
      onPost: async () => undefined,
    }),
  );
  assert.match(html, /Pack suelto/);
  assert.match(html, /Crea una oferta para instalar este pack/);
  assert.doesNotMatch(html, /Application error/);

  const withTags = renderToStaticMarkup(
    React.createElement(BibliotecaPackList, {
      packs: normalizeLibraryPayload({
        packs: [{ id: "csv", title: "Cobros", tags: "cobro, whatsapp" }],
        offers: [{ id: "oferta-1", productName: "Norte" }],
      }).packs,
      offers: normalizeLibraryPayload({
        offers: [{ id: "oferta-1", productName: "Norte" }],
      }).offers,
      initialOpenId: "csv",
      onPost: async () => undefined,
    }),
  );
  assert.match(withTags, /cobro/);
  assert.match(withTags, /whatsapp/);
  assert.match(withTags, /Instalar en Norte/);
});

test("the route error offers a Spanish retry instead of the white screen", () => {
  const html = renderToStaticMarkup(
    React.createElement(RouteError, {
      title: "No se pudo mostrar la biblioteca",
      reset: () => undefined,
    }),
  );
  assert.match(html, /No se pudo mostrar la biblioteca/);
  assert.match(html, /Puedes reintentar/);
  assert.match(html, /Reintentar/);
});
