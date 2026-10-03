import unittest
from types import SimpleNamespace

from long_practice import (
    DEFAULT_MAX_SESSION_MINUTES,
    SUMMARY_INTERVAL_SECONDS,
    SUMMARY_MARKER,
    TARGET_TOKENS,
    TRIGGER_TOKENS,
    LongPractice,
    gemini_long_practice_config,
    max_session_seconds,
    plan_go_away,
    practice_agent_name,
    running_summary,
    summary_note,
    usage_from_metrics,
    with_memory_rule,
)


class CompressionConfigTest(unittest.TestCase):
    def test_realtime_kwargs_match_the_pinned_plugin(self):
        config = gemini_long_practice_config()
        self.assertEqual(set(config), {"context_window_compression", "session_resumption"})
        compression = config["context_window_compression"]
        window = compression.sliding_window
        self.assertEqual(compression.trigger_tokens, TRIGGER_TOKENS)
        self.assertIsNotNone(window)
        self.assertEqual(window.target_tokens, TARGET_TOKENS)
        self.assertLess(window.target_tokens, compression.trigger_tokens)
        self.assertTrue(config["session_resumption"].transparent)
        self.assertIsNone(config["session_resumption"].handle)


class SummaryTest(unittest.TestCase):
    def test_summary_keeps_prices_objections_and_agreements(self):
        summary = running_summary(
            [
                ("closer", "La oferta del Círculo Millonario sale 1500 dólares."),
                ("prospect", "Está caro, lo voy a pensar después."),
                ("closer", "Quedamos en que me confirmas el viernes."),
                ("prospect", "Dale, de acuerdo."),
            ]
        )
        self.assertIn("1500 dólares", summary)
        self.assertIn("caro", summary)
        self.assertIn("Quedamos", summary)
        self.assertIn("Hechos recientes", summary)

    def test_reinjection_pins_the_role_and_does_not_repeat(self):
        base = "Eres un prospecto de Círculo Millonario. Precio de lista 1500."
        pinned = with_memory_rule(base)
        self.assertIn("Círculo Millonario", pinned)
        self.assertIn("no la leas en voz alta", pinned.casefold())
        self.assertEqual(with_memory_rule(pinned), pinned)
        note = summary_note("Precios: 1500 dólares")
        self.assertIn(SUMMARY_MARKER, note)
        self.assertIn("no la leas en voz alta", note)
        self.assertIn("1500 dólares", note)

    def test_summary_is_reinjected_on_the_interval_only(self):
        practice = LongPractice("Eres el prospecto.", started_at=0)
        practice.on_closer_transcript("Sale 2000 dólares", is_final=False)
        self.assertIsNone(practice.summary_due(SUMMARY_INTERVAL_SECONDS))
        practice.on_closer_transcript("Sale 2000 dólares", is_final=True)
        self.assertIsNone(practice.summary_due(SUMMARY_INTERVAL_SECONDS - 1))
        note = practice.summary_due(SUMMARY_INTERVAL_SECONDS)
        self.assertIsNotNone(note)
        self.assertIn("2000 dólares", practice.summary)
        self.assertIsNone(practice.summary_due(SUMMARY_INTERVAL_SECONDS + 10))
        practice.on_conversation_item("assistant", note or "")
        self.assertNotIn(SUMMARY_MARKER, " ".join(text for _, text in practice.lines))


class MaxDurationTest(unittest.TestCase):
    def test_default_is_inside_an_hour_to_ninety_minutes(self):
        seconds = max_session_seconds({})
        self.assertEqual(seconds, DEFAULT_MAX_SESSION_MINUTES * 60)
        self.assertGreaterEqual(seconds, 60 * 60)
        self.assertLessEqual(seconds, 90 * 60)

    def test_short_caps_are_ignored(self):
        self.assertEqual(max_session_seconds({"PRACTICE_MAX_SESSION_MINUTES": "15"}), 75 * 60)
        self.assertEqual(max_session_seconds({"PRACTICE_MAX_SESSION_MINUTES": "20"}), 75 * 60)
        self.assertEqual(max_session_seconds({"PRACTICE_MAX_SESSION_MINUTES": "no"}), 75 * 60)

    def test_explicit_hour_bounds_are_kept(self):
        self.assertEqual(max_session_seconds({"PRACTICE_MAX_SESSION_MINUTES": "60"}), 60 * 60)
        self.assertEqual(max_session_seconds({"PRACTICE_MAX_SESSION_MINUTES": "90"}), 90 * 60)


class GoAwayTest(unittest.TestCase):
    def test_go_away_resumes_and_does_not_end_the_practice(self):
        plan = plan_go_away("10s", "handle-1")
        self.assertEqual(plan.action, "resume")
        self.assertFalse(plan.end_practice)
        self.assertEqual(plan.handle, "handle-1")
        self.assertEqual(plan.time_left, "10s")

        practice = LongPractice("Eres el prospecto.", started_at=0)
        again = practice.on_go_away("5s", None)
        self.assertFalse(again.end_practice)
        self.assertIsNone(again.handle)
        kept = practice.on_go_away("5s", "handle-2")
        self.assertEqual(kept.handle, "handle-2")
        still = practice.on_go_away("1s", None)
        self.assertEqual(still.handle, "handle-2")
        self.assertFalse(still.end_practice)


class UsageTest(unittest.TestCase):
    def test_usage_metadata_is_logged_per_turn_and_totaled(self):
        metrics = SimpleNamespace(
            type="realtime_model_metrics",
            input_tokens=8000,
            output_tokens=400,
            total_tokens=8400,
            input_token_details=SimpleNamespace(audio_tokens=7000),
            output_token_details=SimpleNamespace(audio_tokens=350),
        )
        self.assertIsNone(usage_from_metrics(SimpleNamespace(type="llm_metrics")))
        practice = LongPractice("Eres el prospecto.", started_at=0)
        first = practice.on_metrics(metrics)
        self.assertIn("prompt=8000", first or "")
        self.assertIn("audio_in=7000", first or "")
        metrics.input_tokens = 8100
        metrics.output_tokens = 100
        metrics.total_tokens = 8200
        practice.on_metrics(metrics)
        totals = practice.usage
        self.assertEqual(totals.turns, 2)
        self.assertEqual(totals.sum_prompt_tokens, 16100)
        self.assertEqual(totals.sum_response_tokens, 500)
        self.assertEqual(totals.max_prompt_tokens, 8100)
        self.assertEqual(totals.sum_audio_in_tokens, 14000)
        self.assertIn("sum_prompt=16100", totals.session_log())
        self.assertIn("max_prompt=8100", totals.session_log())


class AgentNameTest(unittest.TestCase):
    def test_production_name_stays_unless_overridden(self):
        self.assertEqual(practice_agent_name({}), "closer-trainer")
        self.assertEqual(
            practice_agent_name({"LIVEKIT_AGENT_NAME": " closer-trainer-preview "}),
            "closer-trainer-preview",
        )


if __name__ == "__main__":
    unittest.main()
