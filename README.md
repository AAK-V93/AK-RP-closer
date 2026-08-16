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
| **Llamada completa** | Agendó cita, llenó formulario, saluda e inicia descubrimiento → pitch → cierre |
| **Solo descubrimiento** | Inicio de llamada; no avanza al pitch |
| **Solo pitch** | Ya descubierto; muestra perfil del prospecto en la UI |
| **Pitch + cierre** | Post-descubrimiento; evalúa p11–p23 |
| **Solo cierre** | Ya conoce el pitch; pega resumen del pitch en la UI |

## Dificultad

- **Fácil** — Colaborativo, comparte info con facilidad
- **Medio** — Reservado, hay que indagar
- **Difícil** — Escéptico, objeciones fuertes, respuestas cortas

## Evaluación

Al terminar la llamada, Gemini puntúa si detectaste **dolor, deseo y urgencia** a profundidad (con preguntas) y si manejaste objeciones/preguntas con el **3A de Hormozi** (Acknowledge, Associate, Ask back).

## Despliegue

- Agente: [LiveKit Deployment Guide](https://docs.livekit.io/agents/deployment/)
- Web: Vercel u otro host Next.js (variables `LIVEKIT_*` + `GEMINI_API_KEY`)

## Licencia

Apache 2.0
