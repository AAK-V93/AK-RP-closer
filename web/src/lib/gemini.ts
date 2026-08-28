const GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
];

export type GeminiOptions = {
  timeoutMs?: number;
  models?: string[];
};

const DEFAULT_TIMEOUT_MS = 90_000;

export async function generateGeminiJson(
  prompt: string,
  temperature = 0.3,
  maxOutputTokens?: number,
  options: GeminiOptions = {},
) {
  return generateGeminiParts([{ text: prompt }], temperature, maxOutputTokens, options);
}

export async function generateGeminiParts(
  parts: object[],
  temperature = 0.2,
  maxOutputTokens?: number,
  options: GeminiOptions = {},
) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const models = options.models?.length ? options.models : GEMINI_MODELS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError = "No Gemini model responded";

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature,
              responseMimeType: "application/json",
              ...(maxOutputTokens ? { maxOutputTokens } : {}),
            },
          }),
        },
      );

      const raw = await response.text();
      if (!response.ok) {
        lastError = raw.slice(0, 280);
        continue;
      }

      const data = JSON.parse(raw) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = "Empty response from Gemini";
        continue;
      }
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = `Gemini tardó más de ${Math.round(timeoutMs / 1000)}s (${model})`;
        continue;
      }
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}
