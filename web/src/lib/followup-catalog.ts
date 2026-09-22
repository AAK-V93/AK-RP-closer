import type { FollowupScript } from "@/lib/followup-scripts";
import catalog from "@/lib/followup-catalog.json";

export type BuiltinFollowupPack = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  scripts: FollowupScript[];
};

export const BUILTIN_FOLLOWUP_PACKS: BuiltinFollowupPack[] = catalog.packs.map((pack) => ({
  id: pack.id,
  title: pack.title,
  description: pack.description,
  tags: pack.tags,
  scripts: pack.scripts.map((row) => ({
    key: row.key,
    type: row.type,
    intentosMin: row.intentosMin,
    canal: row.canal as FollowupScript["canal"],
    recomendacion: row.recomendacion,
    guion: row.guion,
    asset: row.asset || undefined,
  })),
}));

export function builtinPackById(id: string) {
  return BUILTIN_FOLLOWUP_PACKS.find((pack) => pack.id === id) || null;
}

export function builtinScriptId(packId: string, key: string) {
  return `${packId}:${key}`;
}
