'use client';

/**
 * ReviewSection — the "复习" partition of the console.
 *
 * Surfaces the sentences the user should practice today, from
 * GET /api/review/candidates: recently-wrong sentences (from
 * practice_attempts) merged with the user's cloud-favorited sentences.
 * Each card plays audio + jumps straight into the drill on that exact
 * sentence (?lib=&sentence=), so review is one click away from practice.
 *
 * The candidate list is already resolved server-side (text + audio +
 * reason), so no per-lib lesson fetch is needed here — a single round
 * trip renders the whole queue.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  apiReviewCandidates,
  Catalog,
  getAudioUrl,
  readPrefAudioRate,
  readReviewWindowDays,
  ReviewCandidate,
} from '../../api';
import styles from '../../me/me-page.module.css';
import { riseIn, staggerParent } from '../../ds/motion';
import Particles from '@/components/Particles';
import SpecularButton from '@/components/SpecularButton';

interface ReviewSectionProps {
  catalog: Catalog | null;
  catalogError: string | null;
  userId: string;
}

export default function ReviewSection({ catalog, catalogError, userId }: ReviewSectionProps) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<ReviewCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioRate, setAudioRate] = useState(1);

  useEffect(() => {
    setAudioRate(readPrefAudioRate());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    setError(null);
    apiReviewCandidates(readReviewWindowDays())
      .then((res) => {
        if (!cancelled) setCandidates(res.candidates);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载复习列表失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const libName = (libId: string | null): string => {
    if (!libId) return '未分类';
    return catalog?.libs.find((l) => l.id === libId)?.name ?? '已下架词库';
  };

  const onPractice = (libId: string | null, sentenceId: string) => {
    if (!libId) return;
    router.push(`/practice?lib=${encodeURIComponent(libId)}&sentence=${encodeURIComponent(sentenceId)}`);
  };

  if (error) {
    return <p className={styles['me-empty']}>{error}</p>;
  }

  if (candidates === null) {
    return <p className={styles['me-empty']}>加载中…</p>;
  }

  if (candidates.length === 0) {
    return (
      <div className={styles['me-wrong-empty']}>
        <Particles
          particleCount={14}
          speed={0.18}
          particleColors={['#378ADD']}
          className={styles['me-wrong-empty__particles']}
        />
        <p className={styles['me-wrong-empty__title']}>还没有要复习的</p>
        <p className={styles['me-wrong-empty__hint']}>
          做几道题后，答错的句子会出现在这里；收藏的句子也会被带进复习循环。
        </p>
        <SpecularButton
          size="md"
          onClick={() => router.push('/dashboard?section=practice')}
          radius={14}
          tint="#8FCBF0"
          tintOpacity={1}
          textColor="#FFFFFF"
          lineColor="#FFFFFF"
          baseColor="#2F80C0"
          blur={8}
          followMouse
          proximity={400}
          intensity={1.5}
          className={styles['me-wrong-empty__cta']}
        >
          去练习
        </SpecularButton>
      </div>
    );
  }

  return (
    <div className={styles['me-wrong']}>
      <header className={styles['me-wrong__header']}>
        <h2 className={styles['me-section-title']}>复习</h2>
        <p className={styles['me-wrong__count']}>
          共 <strong>{candidates.length}</strong> 句待复习
        </p>
      </header>

      {catalogError ? (
        <p className={styles['me-wrong__warn']}>词库信息加载失败,部分卡片可能不显示词库名。</p>
      ) : null}

      <motion.ul
        className={styles['me-wrong-list']}
        variants={staggerParent}
        initial="hidden"
        animate="show"
      >
        {candidates.map((c) => (
          <motion.li key={c.sentence_id} variants={riseIn}>
            <ReviewCard
              candidate={c}
              libName={libName(c.lib_id)}
              audioRate={audioRate}
              onPractice={onPractice}
            />
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

function ReviewCard({
  candidate,
  libName,
  audioRate,
  onPractice,
}: {
  candidate: ReviewCandidate;
  libName: string;
  audioRate: number;
  onPractice: (libId: string | null, sentenceId: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const ensureAudio = (): HTMLAudioElement | null => {
    if (audioRef.current) return audioRef.current;
    if (typeof document === 'undefined') return null;
    const el = new Audio();
    el.preload = 'none';
    audioRef.current = el;
    el.addEventListener('ended', () => setPlaying(false));
    el.addEventListener('pause', () => setPlaying(false));
    return el;
  };

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = audioRate;
  }, [audioRate]);

  const onPlay = () => {
    if (!candidate.audio_url) return;
    const el = ensureAudio();
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.src = getAudioUrl(candidate.audio_url);
    el.playbackRate = audioRate;
    el.currentTime = 0;
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const reasonLabel = candidate.reason === 'wrong' ? '答错过' : '已收藏';

  return (
    <article className={styles['me-wrong-card']}>
      <div className={styles['me-wrong-card__meta']}>
        <span className={styles['me-wrong-card__lib']}>{libName}</span>
        <span className={styles['me-wrong-card__stats']}>· {reasonLabel}</span>
      </div>
      <p className={styles['me-wrong-card__en']}>{candidate.text}</p>
      <p className={styles['me-wrong-card__zh']}>{candidate.chinese_text}</p>
      <div className={styles['me-wrong-card__actions']}>
        {candidate.audio_url ? (
          <button
            type="button"
            className={styles['me-wrong-card__audio-btn']}
            onClick={onPlay}
            aria-label={playing ? '暂停音频' : '播放音频'}
            title={playing ? '暂停' : `播放 (${audioRate}×)`}
          >
            {playing ? '⏸' : '🔊'}
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles['me-btn']} ${styles['me-btn--primary']}`}
          onClick={() => onPractice(candidate.lib_id, candidate.sentence_id)}
        >
          练这句
        </button>
      </div>
    </article>
  );
}
