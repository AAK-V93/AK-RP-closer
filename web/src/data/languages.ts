export type LanguageCode = "es" | "en" | "pt" | "fr";

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  nativeName: string;
  promptName: string;
}

export const LANGUAGES: LanguageOption[] = [
  {
    code: "es",
    label: "Español",
    nativeName: "Español",
    promptName: "español",
  },
  {
    code: "en",
    label: "English",
    nativeName: "English",
    promptName: "English",
  },
  {
    code: "pt",
    label: "Português",
    nativeName: "Português",
    promptName: "português",
  },
  {
    code: "fr",
    label: "Français",
    nativeName: "Français",
    promptName: "français",
  },
];

export const LANGUAGE_LABELS: Record<LanguageCode, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.label]),
) as Record<LanguageCode, string>;

export function getLanguage(code: LanguageCode): LanguageOption {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
