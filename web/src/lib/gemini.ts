const GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-flash-lite-latest",
];

export async function generateGeminiJson(
  prompt: string,
  temperature = 0.3,
  maxOutputTokens?: number,
) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  let lastError = "No Gemini model responded";

  for (const model of GEMINI_MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
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
  }

  throw new Error(lastError);
}

export async function generateGeminiParts(
  parts: object[],
  temperature = 0.2,
) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  let lastError = "No Gemini model responded";

  for (const model of GEMINI_MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature,
            responseMimeType: "application/json",
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
  }

  throw new Error(lastError);
}
