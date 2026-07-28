'use client';

import { useEffect, useState } from 'react';
import { VocabularyLib, TranslationProgress } from '../api';
import { useAuth } from '../lib/auth';
import { composeLandingData } from './data';
import TypefallDemo from './TypefallDemo';

interface HeroProps {
  libs: VocabularyLib[];
  translationProgress: TranslationProgress;
  /** Parent callback: pick a lib and remount the practice surface.
   *  Used by the bottom CTA when a lib is known. */
  onPickLib: (libId: string) => void;
}

const HERO_TITLE = '听一句，写一句，把英语练出肌肉记忆。';
const HERO_SUBTITLE =
  '基于真实语料的句子听写练习。每天 10 分钟，30 天就能跟读整段播客。';

/**
 * Hero — full-viewport opening with character-level fadeUp + single CTA.
 *
 * Visual: warm radial wash (cool white + a whisper of vermilion at the
 * center) over a 1px grid texture. The main headline is split into
 * per-character <span> nodes that fade up in a 28ms cascade so the
 * title appears to "type itself in" over ~700ms.
 *
 * Below the headline sits a live "中→英听写" demo
 * ({@link TypefallDemo}) — three short sentences cycle through with
 * Chinese on top, English characters "typed" into place below. The
 * single CTA sits immediately under the demo:
 *   - signed-in + a recommended lib exists → "开始今日练习 · <lib>"
 *     calls `onPickLib(libId)` to drop the user straight into practice
 *   - otherwise (no user, or no catalog data) → "登录后开始练习 →"
 *     sends them to /login?from=/ so they bounce back after auth
 *
 * Header chrome (注册 / 登录) handles the dual auth entry; this is
 * the only product CTA on the hero.
 *
 * "下沉箭头" at the bottom of the hero scrolls to the next section.
 */
export default function Hero({ libs, translationProgress, onPickLib }: HeroProps) {
  // Stage 0 → 3 controls the cascade: title (1) → subtitle (2) →
  // demo + chevron + start button (3).
  const [stage, setStage] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    // Title 0→1 (per-char animation) at mount
    const t1 = window.setTimeout(() => setStage(1), 0);
    // Subtitle 1→2 after title settles
    const t2 = window.setTimeout(() => setStage(2), 700);
    // Demo + CTA + chevron 2→3 after subtitle
    const t3 = window.setTimeout(() => setStage(3), 950);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  // Pick the recommended lib for the CTA — same shape as
  // weekly_plan.new_lib_id used by DailyPlan below.
  const landing = composeLandingData({ libs, progress: translationProgress });
  const newLib = libs.find((l) => l.id === landing.weekly_plan.new_lib_id);
  const canStart = !!user && !!newLib;

  const handleStart = () => {
    if (canStart && newLib) {
      onPickLib(newLib.id);
    } else {
      // Anonymous or no catalog — send through login with a return path.
      window.location.href = '/login?from=' + encodeURIComponent('/');
    }
  };

  const startLabel = canStart && newLib
    ? `开始今日练习 · ${newLib.name}`
    : '登录后开始练习';

  const scrollTo = (id: string) => {
    if (typeof document === 'undefined') return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="hero" aria-label="产品介绍">
      <div className="hero__bg" aria-hidden>
        <div className="hero__glow" />
        <div className="hero__grid" />
      </div>

      <div className="hero__inner">
        <p className="hero__caption">Type Any Language</p>

        <h1 className="hero__title" aria-label={HERO_TITLE}>
          {HERO_TITLE.split('').map((ch, i) => (
            <span
              key={i}
              className="hero__char"
              style={{
                animationDelay: `${i * 28}ms`,
                animationPlayState: stage >= 1 ? 'running' : 'paused',
              }}
              aria-hidden
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </h1>

        <p
          className={'hero__subtitle' + (stage >= 2 ? ' hero__subtitle--in' : '')}
          aria-hidden={stage < 2}
        >
          {HERO_SUBTITLE}
        </p>

        {/* Typefall demo — "中→英听写"微观动作的可视化循环,
            放在 subtitle 下方作为产品核心动作的活体示例 */}
        <div
          className={'hero__demo' + (stage >= 3 ? ' hero__demo--in' : '')}
          aria-hidden={stage < 3}
        >
          <TypefallDemo />
        </div>

        {/* 单一动作出口 —— demo 框正下方,36px 高的细按钮。
            匿名态:登录后开始练习(跳 /login);登录态:开始今日练习 + lib 名 */}
        <button
          type="button"
          className={'hero__start' + (stage >= 3 ? ' hero__start--in' : '')}
          onClick={handleStart}
          aria-hidden={stage < 3}
        >
          <span className="hero__start-label">{startLabel}</span>
          <span className="hero__start-arrow" aria-hidden>→</span>
        </button>
      </div>

      <button
        type="button"
        className={'hero__chevron' + (stage >= 3 ? ' hero__chevron--in' : '')}
        onClick={() => scrollTo('daily-plan')}
        aria-label="向下滚动到今日计划"
        aria-hidden={stage < 3}
      >
        <span aria-hidden>⌄</span>
      </button>
    </section>
  );
}