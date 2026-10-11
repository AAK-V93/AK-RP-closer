# Fathom y llamadas (v2, PR 5)

Qué necesita la app para traer llamadas. Nada de esto corre con cron ni con polling.

## Variables de entorno

| Variable | Para qué | Si falta |
|---|---|---|
| `NEXTAUTH_URL` | Dirección pública (https) a la que Fathom manda el webhook: `<NEXTAUTH_URL>/api/fathom/webhook/<token>`. En Vercel, si no está, se usa `VERCEL_URL`. | En producción «Conectar Fathom» se niega con un mensaje claro. |
| `AUTH_SECRET` (o `NEXTAUTH_SECRET`) | Cifra la clave de Fathom y el secreto del webhook. | No se puede conectar. |
| `GEMINI_API_KEY` | Resumen de cada llamada (una sola llamada al modelo por llamada). | Las llamadas se guardan igual y quedan «no se pudo resumir», con «Reintentar». |
| `GEMINI_BRIEF_MODEL` (opcional) | Cambia el modelo del resumen. Por defecto `gemini-3.6-flash`, fijado por nombre. | Se usa el de por defecto. |
| `FATHOM_API_BASE` (solo fuera de producción) | Apunta a un Fathom falso para la prueba local. | Se usa `https://api.fathom.ai/external/v1`. |

## Cómo entra una llamada

1. **Conectar Fathom** (Mis ofertas › Tus llamadas): se valida la clave con una consulta liviana, se borra el webhook anterior si había, se crea uno nuevo (resumen + tareas + transcripción) hacia una URL propia de la persona, y empieza la reconstrucción de los últimos 60 días (`BACKFILL_WINDOW_DAYS`, pendiente de Kali).
2. **Reconstrucción por tandas**: al conectar y luego en cada visita a Hoy mientras esté en curso. Cada tanda pide como máximo 3 páginas de `/meetings` (10 llamadas cada una), guarda el cursor, y si Fathom responde 429 espera lo que diga `Retry-After` (sin reintentar en bucle).
3. **Webhook**: firma verificada, la llamada se guarda una sola vez (si Fathom la reenvía no se duplica) y el resumen se hace después de responder.
4. **Subir una llamada**: transcripción en texto (.txt, .vtt, .srt) o pegada. Si Fathom no resume una llamada, súbela.

La transcripción se guarda una vez y ninguna pantalla la lee; solo «Reintentar» la vuelve a leer para resumir.

## Vista previa de Vercel

Si la vista previa tiene protección de acceso, Fathom no puede entregar el webhook ahí. La reconstrucción y «Subir una llamada» sí funcionan.
