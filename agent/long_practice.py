"""Long voice practices on Gemini Live without re-billing the whole hour.

Verified against the versions pinned in ``agent/uv.lock``:

- ``google-genai`` 1.52.0 types: ``ContextWindowCompressionConfig.trigger_tokens``,
  ``SlidingWindow.target_tokens``, ``SessionResumptionConfig.handle`` and
  ``transparent``, ``LiveServerGoAway.time_left``.
  https://ai.google.dev/api/live
  https://ai.google.dev/gemini-api/docs/live-api/session-management
- ``livekit-plugins-google`` 1.3.5 ``RealtimeModel`` accepts
  ``context_window_compression`` and ``session_resumption``. On ``GoAway`` its
  ``_handle_go_away`` sets ``_session_should_close``, and ``_main_task``
  reconnects with ``SessionResumptionConfig(handle=...)``. The plugin rebuilds
  that config itself and does not forward ``transparent``.
  https://docs.livekit.io/reference/python/v1/livekit/plugins/google/realtime/index.html

Audio is about 25 tokens per second. Without compression the Live API ends an
audio session at about 15 minutes, and each turn can be billed for the whole
accumulated window. Trigger 24_000 tokens (about 16 minutes of one-sided audio,
sooner with both sides) and keep 8_000 (Google's published cost example, and
less than the trigger). System instructions stay outside the sliding window.

The running summary is built locally from the transcript. It does not call
another model. Reinjecting it is a few hundred text tokens every three minutes
inside the session that is already open.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field

# ~16 min of audio at 25 tokens/s before the first compression, under the
# 15-minute uncompressed cap once both sides are speaking. Target is the
# example in https://ai.google.dev/gemini-api/docs/live-api/best-practices
# and must stay below the trigger.
TRIGGER_TOKENS = 24_000
TARGET_TOKENS = 8_000
SUMMARY_INTERVAL_SECONDS = 180
DEFAULT_MAX_SESSION_MINUTES = 75
MAX_SESSION_ENV = "PRACTICE_MAX_SESSION_MINUTES"
AGENT_NAME_ENV = "LIVEKIT_AGENT_NAME"
DEFAULT_AGENT_NAME = "closer-trainer"
SUMMARY_MARKER = "NOTA INTERNA DE LA PRÁCTICA"

_PRICE = re.compile(
    r"(?:\$|€)\s*\d[\d.,]*|\d[\d.,]*\s*(?:\$|€|usd|d[oó]lares?|soles|pesos|mil\b)",
    re.IGNORECASE,
)
_OBJECTION = re.compile(
    r"\b(caro|cara|pensarlo|despu[eé]s|no me convence|objeci[oó]n|muy alto|no tengo)\b",
    re.IGNORECASE,
)
_AGREEMENT = re.compile(
    r"\b(quedamos|de acuerdo|lo tomo|reservo|cerramos|dale|trato hecho)\b",
    re.IGNORECASE,
)


def gemini_long_practice_config():
    """Kwargs for ``google.realtime.RealtimeModel`` on the pinned plugin."""
    from google.genai import types

    return {
        "context_window_compression": types.ContextWindowCompressionConfig(
            trigger_tokens=TRIGGER_TOKENS,
            sliding_window=types.SlidingWindow(target_tokens=TARGET_TOKENS),
        ),
        "session_resumption": types.SessionResumptionConfig(transparent=True),
    }


def practice_agent_name(environ: Mapping[str, str] | None = None) -> str:
    raw = (environ if environ is not None else os.environ).get(AGENT_NAME_ENV, "")
    name = str(raw or "").strip()
    return name or DEFAULT_AGENT_NAME


def max_session_seconds(environ: Mapping[str, str] | None = None) -> int:
    """Safety cap. Default 75 minutes. Values under 60 are ignored.

    A 15 or 20 minute value would cut the hour-long roleplays this exists to
    allow, so those fall back to the default instead of becoming the cap.
    """
    raw = (environ if environ is not None else os.environ).get(MAX_SESSION_ENV, "")
    text = str(raw or "").strip()
    if not text:
        return DEFAULT_MAX_SESSION_MINUTES * 60
    try:
        minutes = int(text)
    except ValueError:
        return DEFAULT_MAX_SESSION_MINUTES * 60
    if minutes < 60 or minutes > 180:
        return DEFAULT_MAX_SESSION_MINUTES * 60
    return minutes * 60


def with_memory_rule(instructions: str) -> str:
    """Pin the prospect role. System instructions are not compressed."""
    text = str(instructions or "").rstrip()
    if SUMMARY_MARKER.casefold() in text.casefold():
        return text
    rule = (
        "\n\nRegla fija: sigues siendo el prospecto de la oferta descrita arriba. "
        "No cambies de papel. Si aparece una nota interna de la práctica, "
        "úsala solo como memoria y no la leas en voz alta."
    )
    return f"{text}{rule}" if text else rule.strip()


def summary_note(summary: str) -> str:
    body = str(summary or "").strip()
    return (
        f"{SUMMARY_MARKER} (no la leas en voz alta). "
        "Sigue siendo el prospecto de la oferta del sistema. "
        f"Memoria de la llamada:\n{body}"
    )


def _clip(text: str, limit: int = 180) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _uniq(items: list[str], limit: int) -> list[str]:
    seen: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.append(item)
    return seen[-limit:]


def running_summary(lines: list[tuple[str, str]]) -> str:
    """Text-only memory: prices, objections, agreements, recent facts."""
    prices: list[str] = []
    objections: list[str] = []
    agreements: list[str] = []
    facts: list[str] = []
    for role, text in lines:
        compact = _clip(text)
        if not compact:
            continue
        label = "Closer" if role == "closer" else "Prospecto"
        if _PRICE.search(compact):
            prices.append(compact)
        if _OBJECTION.search(compact):
            objections.append(compact)
        if _AGREEMENT.search(compact):
            agreements.append(compact)
        facts.append(f"{label}: {compact}")
    parts: list[str] = []
    if _uniq(prices, 4):
        parts.append("Precios: " + " | ".join(_uniq(prices, 4)))
    if _uniq(objections, 4):
        parts.append("Objeciones: " + " | ".join(_uniq(objections, 4)))
    if _uniq(agreements, 4):
        parts.append("Acuerdos: " + " | ".join(_uniq(agreements, 4)))
    if facts:
        parts.append("Hechos recientes: " + " | ".join(facts[-4:]))
    summary = "\n".join(parts)
    if len(summary) > 1200:
        summary = summary[-1200:]
    return summary


def chat_item_text(item: object) -> str:
    text = getattr(item, "text_content", None)
    if callable(text):
        text = text()
    if isinstance(text, str):
        return text
    content = getattr(item, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            else:
                parts.append(str(getattr(part, "text", "") or ""))
        return " ".join(part for part in parts if part)
    return ""


@dataclass(frozen=True)
class GoAwayPlan:
    action: str
    end_practice: bool
    handle: str | None
    time_left: str | None


def plan_go_away(time_left: str | None, handle: str | None) -> GoAwayPlan:
    """A closing notice resumes the same practice. It does not hang up."""
    return GoAwayPlan(
        action="resume",
        end_practice=False,
        handle=handle or None,
        time_left=time_left,
    )


@dataclass
class UsageTotals:
    turns: int = 0
    sum_prompt_tokens: int = 0
    sum_response_tokens: int = 0
    sum_total_tokens: int = 0
    max_prompt_tokens: int = 0
    sum_audio_in_tokens: int = 0
    sum_audio_out_tokens: int = 0
    last: dict[str, int] = field(default_factory=dict)

    def add(self, usage: dict[str, int]) -> None:
        prompt = int(usage.get("input_tokens") or 0)
        response = int(usage.get("output_tokens") or 0)
        total = int(usage.get("total_tokens") or 0)
        audio_in = int(usage.get("audio_input_tokens") or 0)
        audio_out = int(usage.get("audio_output_tokens") or 0)
        self.turns += 1
        self.sum_prompt_tokens += prompt
        self.sum_response_tokens += response
        self.sum_total_tokens += total
        self.max_prompt_tokens = max(self.max_prompt_tokens, prompt)
        self.sum_audio_in_tokens += audio_in
        self.sum_audio_out_tokens += audio_out
        self.last = {
            "input_tokens": prompt,
            "output_tokens": response,
            "total_tokens": total,
            "audio_input_tokens": audio_in,
            "audio_output_tokens": audio_out,
        }

    def turn_log(self) -> str:
        last = self.last
        return (
            "practice usage turn "
            f"n={self.turns} "
            f"prompt={last.get('input_tokens', 0)} "
            f"response={last.get('output_tokens', 0)} "
            f"total={last.get('total_tokens', 0)} "
            f"audio_in={last.get('audio_input_tokens', 0)} "
            f"audio_out={last.get('audio_output_tokens', 0)}"
        )

    def session_log(self) -> str:
        return (
            "practice usage session "
            f"turns={self.turns} "
            f"sum_prompt={self.sum_prompt_tokens} "
            f"sum_response={self.sum_response_tokens} "
            f"sum_total={self.sum_total_tokens} "
            f"max_prompt={self.max_prompt_tokens} "
            f"sum_audio_in={self.sum_audio_in_tokens} "
            f"sum_audio_out={self.sum_audio_out_tokens}"
        )


def usage_from_metrics(metrics: object) -> dict[str, int] | None:
    """Read one Gemini Live ``usage_metadata`` report from the plugin event.

    ``prompt_token_count`` is the whole context for that turn, not a delta.
    Summing prompts estimates what was re-billed. ``max_prompt`` shows whether
    compression held the window.
    """
    if getattr(metrics, "type", None) != "realtime_model_metrics":
        return None
    details = getattr(metrics, "input_token_details", None)
    out_details = getattr(metrics, "output_token_details", None)
    return {
        "input_tokens": int(getattr(metrics, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(metrics, "output_tokens", 0) or 0),
        "total_tokens": int(getattr(metrics, "total_tokens", 0) or 0),
        "audio_input_tokens": int(getattr(details, "audio_tokens", 0) or 0),
        "audio_output_tokens": int(getattr(out_details, "audio_tokens", 0) or 0),
    }


class LongPractice:
    def __init__(self, instructions: str, *, started_at: float) -> None:
        self.instructions = with_memory_rule(instructions)
        self.started_at = started_at
        self.lines: list[tuple[str, str]] = []
        self.summary = ""
        self.usage = UsageTotals()
        self.resumption_handle: str | None = None
        self._last_summary_at = started_at

    def on_closer_transcript(self, text: str, is_final: bool) -> None:
        if not is_final:
            return
        compact = " ".join(str(text or "").split())
        if compact:
            self.lines.append(("closer", compact))

    def on_conversation_item(self, role: str, text: str) -> None:
        if role != "assistant":
            return
        compact = " ".join(str(text or "").split())
        if not compact or SUMMARY_MARKER in compact:
            return
        self.lines.append(("prospect", compact))

    def on_metrics(self, metrics: object) -> str | None:
        usage = usage_from_metrics(metrics)
        if usage is None:
            return None
        self.usage.add(usage)
        return self.usage.turn_log()

    def on_go_away(self, time_left: str | None, handle: str | None) -> GoAwayPlan:
        if handle:
            self.resumption_handle = handle
        plan = plan_go_away(time_left, self.resumption_handle)
        return plan

    def summary_due(self, now: float) -> str | None:
        if now - self._last_summary_at < SUMMARY_INTERVAL_SECONDS:
            return None
        if not self.lines:
            return None
        summary = running_summary(self.lines)
        self._last_summary_at = now
        if not summary or summary == self.summary:
            return None
        self.summary = summary
        return summary_note(summary)


async def reinject_summary(session: object, note: str) -> None:
    """Append the memory note without completing a turn or restarting.

    ``Agent.update_chat_ctx`` on livekit-agents 1.3.5 forwards to the realtime
    session, which sends ``LiveClientContent`` with ``turn_complete=False``.
    ``update_instructions`` would restart the socket, so the role stays in the
    original system prompt and only this note is appended.
    """
    agent = getattr(session, "current_agent", None)
    if agent is None:
        return
    chat_ctx = agent.chat_ctx.copy()
    chat_ctx.add_message(role="assistant", content=note)
    await agent.update_chat_ctx(chat_ctx)
