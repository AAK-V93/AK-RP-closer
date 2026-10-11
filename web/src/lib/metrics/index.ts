// lib/metrics: the single definition of every number on screen (plan 1.3).
// Pure functions: they take rows already read, never touch Prisma.
// Screens, routes and the chat import from here; a CI test fails if they
// compute these numbers on their own (see v2-guards.test.ts).
export * from "./money";
export * from "./deals";
export * from "./commission";
export * from "./followup";
export * from "./results";
export * from "./goal";
export * from "./offer";
export * from "./metas";
export * from "./confirm";
