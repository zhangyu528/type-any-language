'use client';

import { useEffect, useRef, useState } from 'react';
import AudioButton from './AudioButton';
import { DailyWord, DailySentence } from './data';

interface DailyWordSentenceProps {
  dailyWord: DailyWord;
  dailySentence: DailySentence;
}

/**
 * DailyWordSentence — two-card section: "今日一词" + "今日一句".
 *
 * Both cards fade up on entering the viewport (staggered 80ms).
 * Audio playback uses the shared <AudioButton/> so the same primitive
 * is used in the future "错题回炉" card and elsewhere.
 *
 * The Chinese translation is hidden by default and revealed on click
 * for the word card — encourages the learner to attempt the meaning
 * themselves before peeking. Sentence card shows both sides by
 * default (already a one-shot glance).
 */
export default function DailyWordSentence({
  dailyWord,
  dailySentence,
}: DailyWordSentenceProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="daily-word"
      className="daily-ws"
      aria-label="今日一词一句"
    >
      <header className="section-header">
        <p className="section-header__caption">今日精选</p>
        <h2 className="section-header__title">一个词，一句话。</h2>
        <p className="section-header__hint">
          每天 30 秒，跟读一遍，胜过背十张单词卡。
        </p>
      </header>

      <div className="daily-ws__grid">
        <article
          className={'ws-card' + (inView ? ' ws-card--in' : '')}
          style={{ transitionDelay: inView ? '0ms' : '0ms' }}
        >
          <p className="ws-card__caption">今日一词</p>
          <h3 className="ws-card__word">{dailyWord.word}</h3>
          {dailyWord.phonetic && (
            <p className="ws-card__phonetic">{dailyWord.phonetic}</p>
          )}
          <PeekableTranslation text={dailyWord.translation} />

          {dailyWord.example && (
            <div className="ws-card__example">
              <p className="ws-card__example-en">{dailyWord.example}</p>
              <p className="ws-card__example-zh">
                {dailyWord.exampleTranslation}
              </p>
            </div>
          )}

          <div className="ws-card__actions">
            <AudioButton url={dailyWord.audio_url} />
          </div>
        </article>

        <article
          className={'ws-card' + (inView ? ' ws-card--in' : '')}
          style={{ transitionDelay: inView ? '80ms' : '0ms' }}
        >
          <p className="ws-card__caption">今日一句</p>
          <p className="ws-card__sentence-en">{dailySentence.text}</p>
          <p className="ws-card__sentence-zh">{dailySentence.chinese_text}</p>
          <div className="ws-card__actions">
            <AudioButton url={dailySentence.audio_url} />
            <span className="ws-card__difficulty">
              {dailySentence.difficulty}
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}

function PeekableTranslation({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      type="button"
      className="ws-card__peek"
      onClick={() => setRevealed((r) => !r)}
      aria-pressed={revealed}
    >
      {revealed ? (
        <span className="ws-card__translation">{text}</span>
      ) : (
        <span className="ws-card__translation-hint">点击看释义</span>
      )}
    </button>
  );
}
