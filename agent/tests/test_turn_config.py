import unittest

from turn_config import (
    AEC_WARMUP_SECONDS,
    FALSE_INTERRUPTION_TIMEOUT,
    MIN_INTERRUPTION_DURATION,
    MIN_INTERRUPTION_WORDS,
    PREFIX_PADDING_MS,
    agent_session_kwargs,
    gemini_realtime_input_config,
)


class FakeSessionV135:
    def __init__(
        self,
        *,
        min_interruption_duration=0.5,
        min_interruption_words=0,
        resume_false_interruption=True,
        false_interruption_timeout=2.0,
        allow_interruptions=True,
    ):
        pass


class FakeSessionModern:
    def __init__(self, *, turn_handling=None, aec_warmup_duration=None):
        pass


class TurnConfigTest(unittest.TestCase):
    def test_gemini_aad_is_desensitized(self):
        config = gemini_realtime_input_config()
        aad = config.automatic_activity_detection
        self.assertFalse(aad.disabled)
        self.assertEqual(aad.start_of_speech_sensitivity, "START_SENSITIVITY_LOW")
        self.assertEqual(aad.prefix_padding_ms, PREFIX_PADDING_MS)
        self.assertGreaterEqual(PREFIX_PADDING_MS, 300)
        self.assertIsNone(aad.silence_duration_ms)

    def test_session_kwargs_on_locked_sdk(self):
        kwargs = agent_session_kwargs(session_cls=FakeSessionV135)
        self.assertEqual(kwargs["min_interruption_duration"], MIN_INTERRUPTION_DURATION)
        self.assertEqual(kwargs["min_interruption_words"], MIN_INTERRUPTION_WORDS)
        self.assertTrue(kwargs["resume_false_interruption"])
        self.assertEqual(kwargs["false_interruption_timeout"], FALSE_INTERRUPTION_TIMEOUT)
        self.assertNotIn("turn_handling", kwargs)
        self.assertNotIn("aec_warmup_duration", kwargs)

    def test_session_kwargs_on_newer_sdk(self):
        kwargs = agent_session_kwargs(session_cls=FakeSessionModern)
        interruption = kwargs["turn_handling"]["interruption"]
        self.assertEqual(interruption["min_duration"], MIN_INTERRUPTION_DURATION)
        self.assertEqual(interruption["min_words"], MIN_INTERRUPTION_WORDS)
        self.assertTrue(interruption["resume_false_interruption"])
        self.assertEqual(
            interruption["false_interruption_timeout"], FALSE_INTERRUPTION_TIMEOUT
        )
        self.assertEqual(kwargs["aec_warmup_duration"], AEC_WARMUP_SECONDS)


if __name__ == "__main__":
    unittest.main()
