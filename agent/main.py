from __future__ import annotations

import json
import logging
import os
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


async def entrypoint(ctx: JobContext):
    logger.info(f"connecting to room {ctx.room.name}")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    participant = await ctx.wait_for_participant()

    try:
        metadata = json.loads(participant.metadata) if participant.metadata else {}
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse participant metadata: {e}. Using default config.")
        metadata = {}

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

    def create_session(self, config: SessionConfig) -> AgentSession:
        return AgentSession(
            llm=google.realtime.RealtimeModel(
                model=config.model,
                voice=config.voice,
                temperature=config.temperature,
                max_output_tokens=int(config.max_response_output_tokens) if config.max_response_output_tokens != "inf" else None,
                modalities=config.modalities,
                api_key=config.gemini_api_key,
            )
        )

    async def start_session(self, ctx: JobContext, participant: rtc.RemoteParticipant):
        self.ctx = ctx
        self.participant = participant

        self.current_session = self.create_session(self.current_config)
        self.current_agent = CloserTrainerAgent(
            instructions=self.current_config.instructions,
        )

        await self.current_session.start(
            room=ctx.room,
            agent=self.current_agent,
        )

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

        chat_ctx = None
        try:
            if hasattr(self.current_agent, "chat_ctx"):
                chat_ctx = self.current_agent.chat_ctx
        except Exception as e:
            logger.warning(f"Could not preserve chat context: {e}")

        await self.current_session.aclose()

        self.current_session = self.create_session(config)
        self.current_agent = CloserTrainerAgent(
            instructions=config.instructions,
            chat_ctx=chat_ctx,
        )

        await self.current_session.start(
            room=ctx.room,
            agent=self.current_agent,
        )
        logger.info("Session restarted with new config; prospect stays silent until closer speaks")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(agent_name="closer-trainer", entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM))
