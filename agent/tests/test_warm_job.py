import unittest

from warm_job import is_warm_job


class WarmJobTest(unittest.TestCase):
    def test_metadata_or_room_name(self):
        self.assertTrue(is_warm_job("closer-abc", {"warm": True}))
        self.assertTrue(is_warm_job("warm-user-1", {}))
        self.assertFalse(is_warm_job("closer-abc", {"instructions": "hi"}))
        self.assertFalse(is_warm_job("", None))


if __name__ == "__main__":
    unittest.main()
