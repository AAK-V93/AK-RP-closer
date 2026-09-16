"""Barge-in settings for the Gemini Live practice agent.

Gemini Live uses **server-side** VAD (`automatic_activity_detection`). While that
is on, LiveKit `InterruptionOptions` (`min_words`, `resume_false_interruption`)
are ignored — the model decides when the closer interrupted. Keyboard, car noise,
and the agent's own echo look like speech because Gemini Live defaults to
`START_SENSITIVITY_HIGH`.

We keep Gemini AAD (do not add a second STT path / turn-taking latency) and
desensitize start-of-speech. `silence_duration_ms` is left at Google's default:
raising it makes the agent wait longer after real speech.

Docs:
- https://docs.livekit.io/agents/logic/turns/#interruption-in-realtime-mode
- https://ai.google.dev/api/live (AutomaticActivityDetection)
- https://docs.livekit.io/agents/models/realtime/plugins/gemini/
"""

from __future__ import annotations

import inspect
from typing import Any

# Required detected-speech duration before start-of-speech is committed.
# Lower = more false positives (clicks, rumble). API default is very short.
PREFIX_PADDING_MS = 400
MIN_INTERRUPTION_DURATION = 0.5
MIN_INTERRUPTION_WORDS = 3
FALSE_INTERRUPTION_TIMEOUT = 1.5
AEC_WARMUP_SECONDS = 3.0


def gemini_realtime_input_config():
    """Gemini Live AAD: detect speech less often; require ~0.4s of voice."""
    from google.genai import types

    return types.RealtimeInputConfig(
        automatic_activity_detection=types.AutomaticActivityDetection(
            disabled=False,
            start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
            prefix_padding_ms=PREFIX_PADDING_MS,
        )
    )


def agent_session_kwargs(session_cls: Any | None = None) -> dict[str, Any]:
    """Session kwargs that exist on the installed livekit-agents version.

    1.3.5 (this repo's lock) takes `min_interruption_*` on AgentSession.
    Newer SDKs use `turn_handling` + `aec_warmup_duration`. LiveKit still
    ignores most interruption fields while Gemini AAD is on; they apply if
    AAD is later disabled.
    """
    cls = session_cls
    if cls is None:
        from livekit.agents import AgentSession

        cls = AgentSession
    params = inspect.signature(cls.__init__).parameters
    kwargs: dict[str, Any] = {}

    if "turn_handling" in params:
        kwargs["turn_handling"] = {
            "interruption": {
                "enabled": True,
                "min_duration": MIN_INTERRUPTION_DURATION,
                "min_words": MIN_INTERRUPTION_WORDS,
                "resume_false_interruption": True,
                "false_interruption_timeout": FALSE_INTERRUPTION_TIMEOUT,
            }
        }
    else:
        if "min_interruption_duration" in params:
            kwargs["min_interruption_duration"] = MIN_INTERRUPTION_DURATION
        if "min_interruption_words" in params:
            kwargs["min_interruption_words"] = MIN_INTERRUPTION_WORDS
        if "resume_false_interruption" in params:
            kwargs["resume_false_interruption"] = True
        if "false_interruption_timeout" in params:
            kwargs["false_interruption_timeout"] = FALSE_INTERRUPTION_TIMEOUT

    if "aec_warmup_duration" in params:
        kwargs["aec_warmup_duration"] = AEC_WARMUP_SECONDS

    return kwargs
