// Cache tags per user (plan 2.3). Readers in lib/read/cached.ts tag their
// entries with these; writes call invalidate() in lib/write/invalidate.ts.
export const tags = {
  stats: (userId: string) => `u:${userId}:stats`,
  goal: (userId: string) => `u:${userId}:goal`,
  leads: (userId: string) => `u:${userId}:leads`,
  lead: (userId: string, leadId: string) => `u:${userId}:lead:${leadId}`,
  pending: (userId: string) => `u:${userId}:pending`,
  offers: (userId: string) => `u:${userId}:offers`,
  practice: (userId: string) => `u:${userId}:practice`,
  profile: (userId: string) => `u:${userId}:profile`,
  /**
   * Fathom rebuild progress (PR 5). Its own tag because the burst runs in
   * after(): Next drops a revalidateTag inside after() for a tag the same
   * request already revalidated, so «Conectar» revalidates offers and the
   * burst revalidates fathom.
   */
  fathom: (userId: string) => `u:${userId}:fathom`,
};

/** Seconds. 600 for what depends on «hoy» (midnight Bogotá has no write to invalidate it). */
export const REVALIDATE = { today: 600, safety: 3600 } as const;

export type WriteEffect = {
  stats?: boolean;
  goal?: boolean;
  leads?: boolean;
  leadIds?: string[];
  pending?: boolean;
  offers?: boolean;
  practice?: boolean;
  profile?: boolean;
  fathom?: boolean;
};

/** Tags a write must invalidate. A lead change also touches lists (leads). */
export function tagsForWrite(userId: string, effect: WriteEffect): string[] {
  const out = new Set<string>();
  if (effect.stats) out.add(tags.stats(userId));
  if (effect.goal) out.add(tags.goal(userId));
  if (effect.leads || effect.leadIds?.length) out.add(tags.leads(userId));
  for (const id of effect.leadIds ?? []) out.add(tags.lead(userId, id));
  if (effect.pending) out.add(tags.pending(userId));
  if (effect.offers) out.add(tags.offers(userId));
  if (effect.practice) out.add(tags.practice(userId));
  if (effect.profile) out.add(tags.profile(userId));
  if (effect.fathom) out.add(tags.fathom(userId));
  return [...out];
}

/**
 * The common write points of plan 2.2 and what each one invalidates.
 * confirmar: banner, Hoy, Metas, the lead; intento: Hoy, lists, the lead, stats.
 */
export const WRITE_EFFECTS = {
  confirmCall: (leadId: string | null): WriteEffect => ({ stats: true, pending: true, leadIds: leadId ? [leadId] : [], leads: true }),
  logAttempt: (leadId: string): WriteEffect => ({ stats: true, leadIds: [leadId] }),
  ingestCall: (): WriteEffect => ({ pending: true, practice: true, stats: true }),
  // Ingesta (PR 5). The calls card in Mis ofertas reads with the pending tag too.
  briefIngestedCall: (): WriteEffect => ({ pending: true, practice: true, stats: true }),
  retryCallBrief: (): WriteEffect => ({ pending: true, practice: true, stats: true }),
  saveFathomConnection: (): WriteEffect => ({ offers: true }),
  disconnectFathom: (): WriteEffect => ({ offers: true, fathom: true }),
  saveBackfillProgress: (): WriteEffect => ({ fathom: true }),
  applyProposedChange: (leadId: string | null): WriteEffect => ({ stats: true, leads: true, pending: true, leadIds: leadId ? [leadId] : [] }),
  // Confirmar (PR 6): «Deshacer» touches the same things as the tap; «No era interna» brings a call back to the list
  undoProposedChange: (leadId: string | null): WriteEffect => ({ stats: true, leads: true, pending: true, leadIds: leadId ? [leadId] : [] }),
  recoverIgnoredCall: (): WriteEffect => ({ pending: true, practice: true, stats: true }),
  setGoal: (): WriteEffect => ({ goal: true }),
  // Metas (PR 4)
  chooseGoalPath: (): WriteEffect => ({ goal: true }),
  setWeeklyGoal: (): WriteEffect => ({ goal: true }),
  // Mis ofertas (PR 3). Commission/price change Lead.potentialCommission: lists, Hoy and Metas.
  upsertOffer: (): WriteEffect => ({ offers: true, leads: true, stats: true, goal: true }),
  archiveOffer: (): WriteEffect => ({ offers: true, leads: true, goal: true }),
  upsertScript: (): WriteEffect => ({ offers: true }),
  deleteScript: (): WriteEffect => ({ offers: true }),
  addCaseSources: (): WriteEffect => ({ offers: true }),
  addDriveSheet: (): WriteEffect => ({ offers: true }),
  syncCaseSource: (): WriteEffect => ({ offers: true }),
  saveCaseReview: (): WriteEffect => ({ offers: true }),
  addManualCase: (): WriteEffect => ({ offers: true }),
  saveDriveConnection: (): WriteEffect => ({ offers: true }),
} as const;
