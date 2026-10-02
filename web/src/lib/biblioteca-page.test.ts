import assert from "node:assert/strict";
import * as React from "react";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BibliotecaPackList } from "../app/biblioteca/pack-list";
import { RouteError } from "../components/route-error";
import {
  LIBRARY_INTRO,
  LIBRARY_SEARCH,
  libraryKindLabel,
  librarySortLabel,
  libraryUsageLine,
} from "./library-copy";
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
  assert.match(emptyHtml, /Todavía no hay guiones compartidos/);
  assert.doesNotMatch(emptyHtml, /packs|repos|@publisher/);
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
  assert.match(html, /Crea una oferta para usar estos guiones/);
  assert.match(html, /Publicado por Biblioteca/);
  assert.match(html, /aún sin usar/);
  assert.doesNotMatch(html, /@|0 usos|instalar este pack/);
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
  assert.match(withTags, /Usar en Norte/);
  assert.match(withTags, /Usar estos guiones/);
  assert.doesNotMatch(withTags, /Instalar|@publisher|0 usos/);
});

test("biblioteca copy is plain Spanish for a closer", () => {
  assert.equal(
    LIBRARY_INTRO,
    "Guiones de seguimiento listos para usar. Los mejores suben según cuántas veces se usaron y si funcionaron.",
  );
  assert.doesNotMatch(LIBRARY_INTRO, /repos|tagged|estrell|@|pack/i);
  assert.equal(LIBRARY_SEARCH, "Buscar por nombre, quien lo publicó o el tema");
  assert.equal(librarySortLabel("estrellas"), "Favoritos");
  assert.equal(librarySortLabel("puntaje"), "Mejor resultado");
  assert.equal(libraryKindLabel("RETOMAR"), "Retomar contacto");
  assert.equal(libraryKindLabel("PAGO PENDIENTE"), "Pago pendiente");
  assert.equal(
    libraryUsageLine({ publisher: "@Biblioteca", scripts: 8, uses: 0 }),
    "Publicado por Biblioteca · 8 guiones · aún sin usar",
  );
  assert.equal(
    libraryUsageLine({ publisher: "Ana", mine: true, scripts: 1, uses: 2 }),
    "Publicado por ti · 1 guion · 2 usos",
  );

  const html = renderToStaticMarkup(
    React.createElement(BibliotecaPackList, {
      packs: [
        {
          id: "retomar",
          title: "Volver a escribir",
          publisher: "Biblioteca",
          scripts: 8,
          uses: 0,
          items: [{ id: "g1", type: "RETOMAR", canal: "WHATSAPP", guion: "Hola", uses: 0 }],
        },
      ],
      offers: [],
      initialOpenId: "retomar",
      onPost: async () => undefined,
    }),
  );
  assert.match(html, /Publicado por Biblioteca · 8 guiones · aún sin usar/);
  assert.match(html, /Retomar contacto · WhatsApp · aún sin usar/);
  assert.doesNotMatch(html, /RETOMAR|@Biblioteca|0 usos|puntuación|estrell/);
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
