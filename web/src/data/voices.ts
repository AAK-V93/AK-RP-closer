export enum VoiceId {
  PUCK = "Puck",
  CHARON = "Charon",
  KORE = "Kore",
  FENRIR = "Fenrir",
  AOEDE = "Aoede",
  ZEPHYR = "Zephyr",
  LEDA = "Leda",
  ORUS = "Orus",
  CALLIRRHOE = "Callirrhoe",
  AUTONOE = "Autonoe",
  ENCELADUS = "Enceladus",
  IAPETUS = "Iapetus",
  UMBRIEL = "Umbriel",
  ALGIEBA = "Algieba",
  DESPINA = "Despina",
  ERINOME = "Erinome",
  ALGENIB = "Algenib",
  RASALGETHI = "Rasalgethi",
  LAOMEDEIA = "Laomedeia",
  ACHERNAR = "Achernar",
  ALNILAM = "Alnilam",
  SCHEDAR = "Schedar",
  GACRUX = "Gacrux",
  PULCHERRIMA = "Pulcherrima",
  ACHIRD = "Achird",
  ZUBENELGENUBI = "Zubenelgenubi",
  VINDEMIATRIX = "Vindemiatrix",
  SADACHBIA = "Sadachbia",
  SADALTAGER = "Sadaltager",
  SULAFAT = "Sulafat",
}

export interface Voice {
  id: VoiceId;
  name: string;
  characteristic: string;
  /** What the closer sees. The id stays the Gemini voice name. */
  label: string;
}

export const voicesData: Record<VoiceId, Voice> = {
  [VoiceId.ZEPHYR]: { id: VoiceId.ZEPHYR, name: "Zephyr", characteristic: "Bright", label: "Clara" },
  [VoiceId.PUCK]: { id: VoiceId.PUCK, name: "Puck", characteristic: "Upbeat", label: "Animada" },
  [VoiceId.CHARON]: { id: VoiceId.CHARON, name: "Charon", characteristic: "Informative", label: "Serena" },
  [VoiceId.KORE]: { id: VoiceId.KORE, name: "Kore", characteristic: "Firm", label: "Firme" },
  [VoiceId.FENRIR]: { id: VoiceId.FENRIR, name: "Fenrir", characteristic: "Excitable", label: "Viva" },
  [VoiceId.LEDA]: { id: VoiceId.LEDA, name: "Leda", characteristic: "Youthful", label: "Joven" },
  [VoiceId.ORUS]: { id: VoiceId.ORUS, name: "Orus", characteristic: "Firm", label: "Segura" },
  [VoiceId.AOEDE]: { id: VoiceId.AOEDE, name: "Aoede", characteristic: "Breezy", label: "Ligera" },
  [VoiceId.CALLIRRHOE]: { id: VoiceId.CALLIRRHOE, name: "Callirrhoe", characteristic: "Easy-going", label: "Tranquila" },
  [VoiceId.AUTONOE]: { id: VoiceId.AUTONOE, name: "Autonoe", characteristic: "Bright", label: "Brillante" },
  [VoiceId.ENCELADUS]: { id: VoiceId.ENCELADUS, name: "Enceladus", characteristic: "Breathy", label: "Suave" },
  [VoiceId.IAPETUS]: { id: VoiceId.IAPETUS, name: "Iapetus", characteristic: "Clear", label: "Nítida" },
  [VoiceId.UMBRIEL]: { id: VoiceId.UMBRIEL, name: "Umbriel", characteristic: "Easy-going", label: "Calma" },
  [VoiceId.ALGIEBA]: { id: VoiceId.ALGIEBA, name: "Algieba", characteristic: "Smooth", label: "Fluida" },
  [VoiceId.DESPINA]: { id: VoiceId.DESPINA, name: "Despina", characteristic: "Smooth", label: "Pareja" },
  [VoiceId.ERINOME]: { id: VoiceId.ERINOME, name: "Erinome", characteristic: "Clear", label: "Limpia" },
  [VoiceId.ALGENIB]: { id: VoiceId.ALGENIB, name: "Algenib", characteristic: "Gravelly", label: "Grave" },
  [VoiceId.RASALGETHI]: { id: VoiceId.RASALGETHI, name: "Rasalgethi", characteristic: "Informative", label: "Pausada" },
  [VoiceId.LAOMEDEIA]: { id: VoiceId.LAOMEDEIA, name: "Laomedeia", characteristic: "Upbeat", label: "Alegre" },
  [VoiceId.ACHERNAR]: { id: VoiceId.ACHERNAR, name: "Achernar", characteristic: "Soft", label: "Baja" },
  [VoiceId.ALNILAM]: { id: VoiceId.ALNILAM, name: "Alnilam", characteristic: "Firm", label: "Directa" },
  [VoiceId.SCHEDAR]: { id: VoiceId.SCHEDAR, name: "Schedar", characteristic: "Even", label: "Estable" },
  [VoiceId.GACRUX]: { id: VoiceId.GACRUX, name: "Gacrux", characteristic: "Mature", label: "Madura" },
  [VoiceId.PULCHERRIMA]: { id: VoiceId.PULCHERRIMA, name: "Pulcherrima", characteristic: "Forward", label: "Cercana" },
  [VoiceId.ACHIRD]: { id: VoiceId.ACHIRD, name: "Achird", characteristic: "Friendly", label: "Amable" },
  [VoiceId.ZUBENELGENUBI]: { id: VoiceId.ZUBENELGENUBI, name: "Zubenelgenubi", characteristic: "Casual", label: "Suelta" },
  [VoiceId.VINDEMIATRIX]: { id: VoiceId.VINDEMIATRIX, name: "Vindemiatrix", characteristic: "Gentle", label: "Dulce" },
  [VoiceId.SADACHBIA]: { id: VoiceId.SADACHBIA, name: "Sadachbia", characteristic: "Lively", label: "Enérgica" },
  [VoiceId.SADALTAGER]: { id: VoiceId.SADALTAGER, name: "Sadaltager", characteristic: "Knowledgeable", label: "Sabia" },
  [VoiceId.SULAFAT]: { id: VoiceId.SULAFAT, name: "Sulafat", characteristic: "Warm", label: "Cálida" },
};

export const voices: Voice[] = Object.values(voicesData);

/** Idle picker. Five labels; the rest stay behind «Más voces». Ids are unchanged. */
export const CURATED_VOICE_IDS: VoiceId[] = [
  VoiceId.CHARON,
  VoiceId.KORE,
  VoiceId.SULAFAT,
  VoiceId.PUCK,
  VoiceId.ALGENIB,
];

export function curatedVoices() {
  return CURATED_VOICE_IDS.map((id) => voicesData[id]);
}
