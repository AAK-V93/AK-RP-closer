# AK-RP — Closer Trainer

Simulador de ventas por voz para entrenar closers. El agente actúa como **prospecto interesado**. Al terminar, evalúa si detectaste dolor, deseo y urgencia a profundidad y si manejaste objeciones con el 3A (Acknowledge, Associate, Ask back).

## Estructura

- **`/agent`** — Agente Python (LiveKit Agents + Gemini Live API)
- **`/web`** — Frontend Next.js

## Configuración

```bash
cp .env.example .env.local
# Completa LIVEKIT_* y GEMINI_API_KEY
```

La API key de Gemini va **solo en el servidor** (`.env.local`), no la ingresa el usuario.

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
pnpm dev
# → http://localhost:3000
```

## Modos de práctica

| Modo | Comportamiento del prospecto |
|------|------------------------------|
| **Reunión completa** | Agendó la reunión y llenó el formulario. Espera a que el closer abra. Descubrimiento → pitch → cierre |
| **Solo descubrimiento** | Inicio de reunión; no avanza al pitch. El closer abre |
| **Solo pitch** | Ya descubierto; no saluda ni pregunta de qué se trata |
| **Pitch + cierre** | Post-descubrimiento; el closer retoma con el pitch |
| **Solo cierre** | Ya conoce el pitch; pega resumen del pitch en la UI |

## Dificultad

- **Fácil** — Colaborativo, comparte info con facilidad
- **Medio** — Reservado, hay que indagar
- **Difícil** — Escéptico, objeciones fuertes, respuestas cortas

## Evaluación

Al terminar, Gemini arma un reporte tipo QC. Si estás logueada, se guarda y en **Mi coaching** ves errores repetidos y sugerencias.

## Coaching (historial)

En `web/`:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

Variables: `DATABASE_URL` (Postgres, p.ej. Neon), `AUTH_SECRET` / `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.

Login con Google (recomendado): `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. En Google Cloud → APIs & Services → Credentials → OAuth client (Web). Authorized redirect URIs:

- `http://localhost:3000/api/auth/callback/google`
- `https://TU-APP.vercel.app/api/auth/callback/google`

## Despliegue

- Agente: [LiveKit Deployment Guide](https://docs.livekit.io/agents/deployment/)
- Web: Vercel u otro host Next.js (variables `LIVEKIT_*` + `GEMINI_API_KEY`)

## Licencia

Apache 2.0
