'use client';

import { useEffect, useRef } from 'react';
import {
  getAudioUrl,
  WordInLesson,
  LessonSentence,
} from './api';

interface RecognitionStageProps {
  /** The target word being shown. */
  word: WordInLesson;
  /** Sentences that contain this word. Used to pick a beginner-sentence
   *  audio for the "听发音" button. May be empty if the bake hasn't
   *  covered this word yet — in that case the audio button is hidden. */
  sentences: LessonSentence[];
  /** Called when the user clicks "下一阶段" to advance to Stage 2. */
  onAdvance: () => void;
}

/**
 * RecognitionStage — Stage 1 of a target word's 2-stage ladder.
 *
 * Shows the word at a generous size with its IPA + Chinese, and lets
 * the user hear it in context by playing a beginner-sentence audio.
 * No typing. The "下一阶段" button moves to Stage 2 (听写).
 *
 * Auto-play: on mount, play the first sentence audio (with a 400ms
 * delay, matching the dictation auto-play pattern). The user can
 * replay with the explicit "听发音" button.
 */
export default function RecognitionStage({
  word,
  sentences,
  onAdvance,
}: RecognitionStageProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Pick the best audio candidate: prefer a beginner sentence;
  // fall back to the first sentence available, in any difficulty.
  const audioSentence: LessonSentence | undefined =
    sentences.find((s) => s.difficulty === 'beginner') ?? sentences[0];

  const playAudio = () => {
    if (!audioSentence?.audio_url || !audioRef.current) return;
    audioRef.current.src = getAudioUrl(audioSentence.audio_url);
    audioRef.current.play().catch(() => {
      /* autoplay-policy rejection on first call — silent */
    });
  };

  // Auto-play on mount. The .catch is a no-op for the very first
  // mount (no user gesture yet); subsequent advance-into-then-out-of
  // a stage counts as a gesture and lets the audio play.
  useEffect(() => {
    const t = setTimeout(playAudio, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id]);

  return (
    <div className="recognition">
      <audio ref={audioRef} />

      <p className="recognition__caption" lang="zh-CN">
        认识这个单词
      </p>

      <div className="recognition__word-block">
        <h2 className="recognition__word">{word.word}</h2>
        {word.phonetic && (
          <p className="recognition__phonetic" aria-label="音标">
            {word.phonetic}
          </p>
        )}
        {word.translation && (
          <p className="recognition__translation" lang="zh-CN">
            {word.translation}
          </p>
        )}
      </div>

      <div className="recognition__actions">
        {audioSentence?.audio_url ? (
          <button
            type="button"
            className="recognition__play"
            onClick={playAudio}
            aria-label="听发音"
          >
            <span className="recognition__play-glyph" aria-hidden>♪</span>
            <span>听发音</span>
          </button>
        ) : (
          <p className="recognition__no-audio">（暂无音频）</p>
        )}

        <button
          type="button"
          className="recognition__next"
          onClick={onAdvance}
        >
          下一阶段 →
        </button>
      </div>
    </div>
  );
}
