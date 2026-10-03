from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, List

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    WorkerType,
    cli,
    utils,
)
from livekit.plugins import google

from long_practice import (
    TARGET_TOKENS,
    TRIGGER_TOKENS,
    LongPractice,
    chat_item_text,
    gemini_long_practice_config,
    max_session_seconds,
    practice_agent_name,
    reinject_summary,
    with_memory_rule,
)
from turn_config import agent_session_kwargs, gemini_realtime_input_config
from warm_job import is_warm_job

load_dotenv(dotenv_path=".env.local")

logger = logging.getLogger("closer-trainer")
logger.setLevel(logging.INFO)

# Suppress OpenTelemetry attribute warnings
logging.getLogger("opentelemetry.attributes").setLevel(logging.ERROR)


@dataclass
class SessionConfig:
    gemini_api_key: str
    instructions: str
    model: str
    voice: str
    temperature: float
    max_response_output_tokens: str | int
    modalities: list[str]

    def to_dict(self):
        return {k: v for k, v in asdict(self).items() if k != "gemini_api_key"}

    @staticmethod
    def _modalities_from_string(
        modalities: str,
    ) -> list[str]:
        modalities_map: Dict[str, List[str]] = {
            "text_and_audio": ["TEXT", "AUDIO"],
            "text_only": ["TEXT"],
            "audio_only": ["AUDIO"],
        }
        return modalities_map.get(modalities, modalities_map["audio_only"])

    def __eq__(self, other) -> bool:
        return self.to_dict() == other.to_dict()


def parse_session_config(data: Dict[str, Any]) -> SessionConfig:
    return SessionConfig(
        gemini_api_key=data.get("gemini_api_key") or os.getenv("GEMINI_API_KEY", ""),
        instructions=data.get("instructions", ""),
        model=data.get("model", "gemini-2.5-flash-native-audio-preview-12-2025"),
        voice=data.get("voice", "Puck"),
        temperature=float(data.get("temperature", 0.8)),
        max_response_output_tokens=
            "inf" if data.get("max_output_tokens") == "inf"
            else int(data.get("max_output_tokens") or 2048),
        modalities=SessionConfig._modalities_from_string(
            data.get("modalities", "audio_only")
        ),
    )


def _load_metadata(raw: str | None) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning(f"Failed to parse metadata: {exc}. Using default config.")
        return {}
    return parsed if isinstance(parsed, dict) else {}


def choose_session_metadata(job_meta: Dict[str, Any] | None, participant_raw: str | None) -> Dict[str, Any]:
    """Instructions for Gemini.

    Dispatch-on-join (LIVEKIT_PREDISPATCH unset) puts the same JSON on the
    participant token and, when LiveKit copies it, on the job. Prefer the job
    only when it actually carries instructions. Otherwise use the participant,
    which is what the worker deployed on 15 Sep read.
    """
    job = job_meta if isinstance(job_meta, dict) else {}
    participant = _load_metadata(participant_raw)
    if job.get("instructions"):
        return job
    if participant.get("instructions"):
        return participant
    if job:
        return {**participant, **job}
    return participant


def closer_already_in_room(room: rtc.Room) -> rtc.RemoteParticipant | None:
    """Dispatch-on-join puts the closer in the room before this process starts.

    wait_for_participant only hears the next join event, so an already-present
    closer would sit there until the timeout while Gemini never starts.
    """
    remotes = getattr(room, "remote_participants", None) or {}
    values = list(remotes.values()) if isinstance(remotes, dict) else list(remotes)
    return values[0] if values else None


async def entrypoint(ctx: JobContext):
    job_meta = _load_metadata(getattr(getattr(ctx, "job", None), "metadata", "") or "")
    room_name = getattr(getattr(ctx, "room", None), "name", "") or ""
    if is_warm_job(room_name, job_meta):
        # Wakes an idle process only. A ~20s browser connect is this worker
        # cold-starting (no idle process, Gemini import), not a reason to set
        # LIVEKIT_PREDISPATCH.
        logger.info("warm job; leaving without starting the model")
        return

    logger.info(f"connecting to room {ctx.room.name}")
    # Join first so the closer sees "Casi listo" while Gemini is still starting.
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    participant = closer_already_in_room(ctx.room)
    if participant is not None:
        logger.info("closer already in the room; starting the model without waiting")
    else:
        try:
            participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=75)
        except asyncio.TimeoutError:
            logger.info("no closer joined; leaving without starting the model")
            return

    metadata = choose_session_metadata(job_meta, participant.metadata)

    config = parse_session_config(metadata)
    session_manager = SessionManager(config)
    await session_manager.start_session(ctx, participant)

    logger.info("agent started")


class CloserTrainerAgent(Agent):
    def __init__(self, instructions: str, tools=None, chat_ctx=None):
        if chat_ctx:
            super().__init__(instructions=instructions, tools=tools or [], chat_ctx=chat_ctx)
        else:
            super().__init__(instructions=instructions, tools=tools or [])
        self.session_manager = None


class SessionManager:
    def __init__(self, config: SessionConfig):
        self.current_session: AgentSession | None = None
        self.current_config: SessionConfig = config
        self.ctx: JobContext | None = None
        self.participant: rtc.RemoteParticipant | None = None
        self.current_agent: CloserTrainerAgent | None = None
        self.practice: LongPractice | None = None
        self._practice_tasks: list[asyncio.Task[Any]] = []
        self._shutdown_registered = False

    def create_session(self, config: SessionConfig) -> AgentSession:
        return AgentSession(
            llm=google.realtime.RealtimeModel(
                model=config.model,
                voice=config.voice,
                temperature=config.temperature,
                max_output_tokens=int(config.max_response_output_tokens) if config.max_response_output_tokens != "inf" else None,
                modalities=config.modalities,
                api_key=config.gemini_api_key,
                realtime_input_config=gemini_realtime_input_config(),
                **gemini_long_practice_config(),
            ),
            **agent_session_kwargs(),
        )

    def _cancel_practice_tasks(self) -> None:
        for task in self._practice_tasks:
            task.cancel()
        self._practice_tasks = []

    def _bind_long_practice(self, ctx: JobContext, session: AgentSession) -> None:
        self._cancel_practice_tasks()
        practice = LongPractice(
            self.current_config.instructions,
            started_at=time.monotonic(),
        )
        self.practice = practice
        limit = max_session_seconds()
        logger.info(
            "long practice compression trigger=%s target=%s max_seconds=%s",
            TRIGGER_TOKENS,
            TARGET_TOKENS,
            limit,
        )
        logger.info(
            "session resumption is on; GoAway reconnects inside "
            "livekit-plugins-google 1.3.5 and does not end the practice"
        )

        @session.on("user_input_transcribed")
        def _closer(ev: Any) -> None:
            practice.on_closer_transcript(
                getattr(ev, "transcript", ""),
                bool(getattr(ev, "is_final", False)),
            )

        @session.on("conversation_item_added")
        def _item(ev: Any) -> None:
            item = getattr(ev, "item", None)
            practice.on_conversation_item(
                str(getattr(item, "role", "") or ""),
                chat_item_text(item),
            )

        @session.on("metrics_collected")
        def _metrics(ev: Any) -> None:
            line = practice.on_metrics(getattr(ev, "metrics", None))
            if line:
                logger.info(line)

        @session.on("close")
        def _close(_ev: Any) -> None:
            logger.info(practice.usage.session_log())

        async def _summary_loop() -> None:
            while True:
                await asyncio.sleep(30)
                note = practice.summary_due(time.monotonic())
                if not note:
                    continue
                logger.info("practice summary stored chars=%s", len(practice.summary))
                try:
                    await reinject_summary(session, note)
                except Exception as exc:  # noqa: BLE001 — a note must not end the call
                    logger.warning("practice summary reinject failed: %s", exc)

        async def _max_duration() -> None:
            await asyncio.sleep(limit)
            logger.info("practice max duration reached seconds=%s", limit)
            current = asyncio.current_task()
            for task in list(self._practice_tasks):
                if task is not current:
                    task.cancel()
            await session.aclose()

        self._practice_tasks = [
            asyncio.create_task(_summary_loop(), name="practice-summary"),
            asyncio.create_task(_max_duration(), name="practice-max-duration"),
        ]

        async def _shutdown() -> None:
            self._cancel_practice_tasks()

        if not self._shutdown_registered:
            self._shutdown_registered = True
            add_shutdown = getattr(ctx, "add_shutdown_callback", None)
            if add_shutdown:
                add_shutdown(_shutdown)

    async def start_session(self, ctx: JobContext, participant: rtc.RemoteParticipant):
        self.ctx = ctx
        self.participant = participant

        self.current_session = self.create_session(self.current_config)
        self.current_agent = CloserTrainerAgent(
            instructions=with_memory_rule(self.current_config.instructions),
        )

        await self.current_session.start(
            room=ctx.room,
            agent=self.current_agent,
        )
        self._bind_long_practice(ctx, self.current_session)

        # The closer always opens. Do not generate a prospect greeting.

        @ctx.room.local_participant.register_rpc_method("pg.updateConfig")
        async def update_config(data: rtc.rpc.RpcInvocationData):
            logger.info(f"update_config called by {data.caller_identity}: {data.payload}")
            if self.current_session is None or data.caller_identity != participant.identity:
                logger.info("update_config called by non-participant or no session")
                return json.dumps({"changed": False})

            new_config = parse_session_config(json.loads(data.payload))
            if self.current_config != new_config:
                logger.info(
                    f"config changed: {new_config.to_dict()}, participant: {participant.identity}"
                )
                self.current_config = new_config
                await self.replace_session(ctx, participant, new_config)
                return json.dumps({"changed": True})
            logger.info("config not changed at all")
            return json.dumps({"changed": False})

    @utils.log_exceptions(logger=logger)
    async def replace_session(self, ctx: JobContext, participant: rtc.RemoteParticipant, config: SessionConfig):
        if self.current_session is None or self.current_agent is None:
            return

        self._cancel_practice_tasks()

        chat_ctx = None
        try:
            if hasattr(self.current_agent, "chat_ctx"):
                chat_ctx = self.current_agent.chat_ctx
        except Exception as e:
            logger.warning(f"Could not preserve chat context: {e}")

        await self.current_session.aclose()

        self.current_session = self.create_session(config)
        self.current_agent = CloserTrainerAgent(
            instructions=with_memory_rule(config.instructions),
            chat_ctx=chat_ctx,
        )

        await self.current_session.start(
            room=ctx.room,
            agent=self.current_agent,
        )
        self._bind_long_practice(ctx, self.current_session)
        logger.info("Session restarted with new config; prospect stays silent until closer speaks")


def prewarm(proc: Any) -> None:
    # Import the realtime plugin before a job arrives so a warm process
    # spends the join wait on Gemini, not on importing the worker.
    proc.userdata["google"] = google


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            agent_name=practice_agent_name(),
            entrypoint_fnc=entrypoint,
            worker_type=WorkerType.ROOM,
            prewarm_fnc=prewarm,
            num_idle_processes=1,
        )
    )
