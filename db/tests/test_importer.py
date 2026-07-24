from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import importer  # noqa: E402


class RecordingCursor:
    def __init__(self) -> None:
        self.executions: list[tuple[str, tuple | None]] = []

    def execute(self, sql: str, params=None) -> None:
        self.executions.append((" ".join(sql.split()), params))


class CursorContext:
    def __init__(self, cursor: RecordingCursor) -> None:
        self.cursor = cursor

    def __enter__(self) -> RecordingCursor:
        return self.cursor

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None


class FakeConnection:
    def __init__(self) -> None:
        self.cursor_instance = RecordingCursor()

    def cursor(self) -> CursorContext:
        return CursorContext(self.cursor_instance)


class ImportVocabTests(unittest.TestCase):
    def test_repeat_import_preserves_cached_total_word_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            content = Path(tmp)
            vocab_dir = content / "vocabulary"
            vocab_dir.mkdir()
            (vocab_dir / "beginner.json").write_text(
                json.dumps(
                    {
                        "level": "beginner",
                        "display": "Beginner Vocabulary",
                        "words": [{"word": "hello"}, {"word": "world"}],
                    }
                ),
                encoding="utf-8",
            )

            conn = FakeConnection()
            with (
                patch.object(importer, "_upsert_lib", return_value="lib-1"),
                patch.object(importer, "_upsert_words", return_value=0),
            ):
                stats = importer.import_vocab(content, conn)

        self.assertEqual(stats, {"beginner": 0})
        count_updates = [
            (sql, params)
            for sql, params in conn.cursor_instance.executions
            if sql.startswith("UPDATE vocabulary_libs SET word_count")
        ]
        self.assertEqual(len(count_updates), 1)
        sql, params = count_updates[0]
        self.assertIn("SELECT COUNT(*) FROM vocabulary_words WHERE lib_id = %s", sql)
        self.assertEqual(params, ("lib-1", "lib-1"))


if __name__ == "__main__":
    unittest.main()
