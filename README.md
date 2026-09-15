# AK-RP — Closer Trainer

Entrenador de cierre high-ticket. El bot de voz actúa como **tus leads reales**. Subes o sincronizas llamadas, extraes cómo hablan, practicas, recibes QC y el CRM se llena al confirmar.

El bot **no es el coach**. El bot es el prospecto. El coach es otra capa.

Producción: `https://ak-rp-closer-x3ir.vercel.app` (Vercel Root Directory = `web`).

## Qué hay en la app

Navegación: **Inicio · Llamadas · Práctica · Coach · CRM · Ofertas · Biblioteca**. Hay que estar logueada (Google o email).

| Pantalla | Para qué |
|----------|----------|
| **Inicio** `/` | Onboarding, práctica, o atajos + pendientes del día |
| **Llamadas** `/llamadas` | Fathom + Google Calendar, uploads, biblioteca |
| **Práctica** `/practicar` | Roleplay por voz (LiveKit). **Compose** o **Replay** |
| **Coach** `/coach` | Chat persistente + insights + historial |
| **CRM** `/crm` | Lectura: cola, métricas, comisiones. Se escribe por chat o botones |
| **Ofertas** `/ofertas` | Oferta completa (precio, pagos, comisión). Gates `ready` y `ready_crm` |
| **Biblioteca** `/biblioteca` | Packs de seguimiento: publicar, estrellar, instalar |

## Estructura

- **`/agent`** — Agente Python (LiveKit Agents + Gemini Live). Nombre `closer-trainer`
- **`/web`** — Next.js 15 (Prisma + Neon, NextAuth, Gemini en servidor)

## Configuración

```bash
cp .env.example .env.local
# Completa LIVEKIT_* y GEMINI_API_KEY
```

La API key de Gemini va **solo en el servidor**.

Auth: `DATABASE_URL` (Postgres, p.ej. Neon), `AUTH_SECRET` / `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. Login con Google: `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Redirect URIs:

- `http://localhost:3000/api/auth/callback/google`
- `https://TU-APP.vercel.app/api/auth/callback/google`
- Calendar (mismo OAuth client): `/api/calendar/callback`

Email diario de alertas (opcional): `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `CRON_SECRET`. Cron: `GET /api/cron/alert-digest` a las 13:00 UTC (8am Lima). `CRON_SECRET` lo generas tú (`openssl rand -hex 32`) y lo pegas en Vercel → Environment Variables; Vercel lo envía solo al cron.

WhatsApp (Twilio) es opcional y se puede dejar para después: el closer ya ve las alertas en Inicio/CRM y el digest llega por email.

## Arranque local

```bash
# Terminal 1 — Agente
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # o: uv sync
python main.py dev

# Terminal 2 — Web
cd web
pnpm install
pnpm exec prisma generate
pnpm dev
# → http://localhost:3000
```

Schema: `pnpm exec prisma db push` en `web/` la primera vez.

## Flujo

1. Guardas **oferta** y **llamadas** (Fathom o archivo). El playbook se extrae y luego **se agrega**, no se reescribe entero.
2. El extractor llena el CRM **solo** si hay confianza ≥ 85. Si falta un dato, el hub pregunta **ese hueco**.
3. QC de Fathom o **Auditar** en un upload → reporte en Coach.
4. **Practicas**: compose o replay. Al colgar de verdad: reporte + “¿practicamos esto otra vez?”. Colgada corta: no se evalúa.
5. En Coach puedes **borrar un análisis** (desvincula Fathom para re-auditar).

## Práctica

| Modo | Comportamiento |
|------|----------------|
| **Reunión completa** | Agendó y llenó el formulario. El closer abre. Descubrimiento → pitch → cierre |
| **Solo descubrimiento** | No avanza al pitch |
| **Solo pitch** | Ya descubierto; no saluda |
| **Pitch + cierre** | El closer retoma con el pitch |
| **Solo cierre** | Pega resumen del pitch en la UI |

Dificultad = cuánta info *relevante* se guarda el lead (fácil / medio / difícil), no si habla o no.

**Compose** arma un lead nuevo desde el playbook. **Replay** usa speakers del transcript (Fathom) o el etiquetado del clasificador (uploads).

El agente **no habla primero**.

## Despliegue

- Agente: [LiveKit Deployment Guide](https://docs.livekit.io/agents/deployment/)
- Web: Vercel (Root Directory `web`; variables `LIVEKIT_*` + `GEMINI_API_KEY` + auth/DB)

## Licencia

Apache 2.0
