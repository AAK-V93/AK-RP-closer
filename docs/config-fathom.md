# Fathom y llamadas (v2, PR 5)

Qué necesita la app para traer llamadas. Nada de esto corre con cron ni con polling.

## Variables de entorno

| Variable | Para qué | Si falta |
|---|---|---|
| `NEXTAUTH_URL` | Dirección pública (https) a la que Fathom manda el webhook: `<NEXTAUTH_URL>/api/fathom/webhook/<token>`. En Vercel, si no está, se usa `VERCEL_URL`. | En producción «Conectar Fathom» se niega con un mensaje claro. |
| `AUTH_SECRET` (o `NEXTAUTH_SECRET`) | Cifra la clave de Fathom y el secreto del webhook. | No se puede conectar. |
| `GEMINI_API_KEY` | Resumen de cada llamada (una sola llamada al modelo por llamada). | Las llamadas se guardan igual y quedan «no se pudo resumir», con «Reintentar». |
| `GEMINI_BRIEF_MODEL` (opcional) | Cambia el modelo del resumen. Por defecto `gemini-3.6-flash`, fijado por nombre. | Se usa el de por defecto. |
| `FATHOM_BACKFILL_DAYS` (opcional) | Cuántos días hacia atrás trae la reconstrucción al conectar (entero de 1 a 365). | 60 días (pendiente de Kali). |
| `FATHOM_WEBHOOK_IN_PREVIEW` (opcional) | Con `1`, una vista previa de Vercel (`VERCEL_ENV=preview`) sí crea su webhook. | En vista previa no se crea webhook. |
| `FATHOM_API_BASE` (solo fuera de producción) | Apunta a un Fathom falso para la prueba local. | Se usa `https://api.fathom.ai/external/v1`. |

## Cómo entra una llamada

1. **Conectar Fathom** (Mis ofertas › Tus llamadas): se valida la clave con una consulta liviana, se borra el webhook anterior **solo si lo creó este mismo despliegue** (ver abajo), se crea uno nuevo (resumen + tareas + transcripción) hacia una URL propia de la persona, y empieza la reconstrucción de los últimos 60 días (`FATHOM_BACKFILL_DAYS`).
2. **Reconstrucción por tandas**: al conectar y luego en cada visita a Hoy mientras esté en curso. Cada tanda pide como máximo 2 páginas de `/meetings` (10 llamadas cada una, `PAGES_PER_BURST`) y no empieza otra página pasados 12 s, guarda el cursor, y si Fathom responde 429 espera lo que diga `Retry-After` (sin reintentar en bucle).
3. **Webhook**: firma verificada, la llamada se guarda una sola vez (si Fathom la reenvía no se duplica) y el resumen se hace después de responder. Si la misma reunión llegó antes sin `recording_id` (guardada por su link) y después llega con él, se actualiza esa fila: mismo link, o mismo título y hora.
4. **Subir una llamada**: transcripción en texto (.txt, .vtt, .srt) o pegada. Si Fathom no resume una llamada, súbela.

La transcripción se guarda una vez y ninguna pantalla la lee; solo «Reintentar» la vuelve a leer para resumir.

## Los webhooks son de la clave, no del despliegue

En Fathom un webhook pertenece a la clave de API. Producción y una vista previa conectadas con la misma clave ven los mismos webhooks. Por eso:

- La app **nunca lista** los webhooks de la cuenta y nunca borra uno que no creó.
- Al conectar, reconectar o desconectar solo borra el `webhookId` guardado en **esta** base de datos, y solo si su URL guardada (`webhookUrl`) apunta al dominio de **este** despliegue (`NEXTAUTH_URL` / `VERCEL_URL`). Un webhook de otro dominio queda intacto.
- Desconectar desde un despliegue que no creó el webhook borra la conexión en esta base, pero deja el webhook en Fathom (lo maneja el despliegue que lo creó). Si un webhook queda huérfano, Fathom recibe 404 en esa URL; se puede borrar a mano en Fathom.

## Vista previa de Vercel

En una vista previa (`VERCEL_ENV=preview`) **no se crea webhook** salvo que `FATHOM_WEBHOOK_IN_PREVIEW=1`. Conectar guarda la clave y hace la reconstrucción; si en la base ya había un webhook (de producción, por ejemplo) se deja tal cual. La pantalla dice que en esta versión de prueba las llamadas nuevas no llegan solas y que se suban. La reconstrucción y «Subir una llamada» funcionan igual.

Si se activa el webhook en una vista previa con protección de acceso, Fathom no puede entregarlo ahí.

## Tiempo de una tanda (medido en local, PR 5)

30 reuniones con transcripción de ~54 000 caracteres cada una (~834 KB por página de 10), Postgres local:

| Escenario | Pedir página | Guardar 10 | Resúmenes (en paralelo) | Página |
|---|---|---|---|---|
| Sin latencia (Fathom y modelo falsos a 0 ms) | ~1 ms | 70–140 ms | 7–200 ms | 80–270 ms |
| Fathom 1,5 s y modelo 8 s simulados | 1,5 s | 90–240 ms | 8,0 s | ~9,6 s |

Cada página hace ~150 consultas a la base (~15 por reunión; ~5 en serie al guardar y ~10 por resumen, estos en paralelo). Con Neon por HTTP (~10–40 ms cada una) guardar 10 suma ~0,5–2 s. Una página real queda en ~10–20 s y el resumen puede tardar hasta su límite de 45 s; con 3 páginas una tanda podía pasar el límite de 60 s de la función, por eso son 2 páginas y no se empieza otra pasados 12 s. Cada página escribe en el log `[fathom] backfill page …` con sus tiempos.
