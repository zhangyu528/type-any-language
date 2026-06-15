'use client';

import { useState, useEffect, useRef } from 'react';

interface AudioPlayerBarProps {
  isPlaying: boolean;
  currentIndex: number;     // 0-based 当前题号
  totalCount: number;       // 总题数
  speed: number;            // 0.5 | 1 | 2
  onSpeedChange: (speed: number) => void;
  isLooping: boolean;       // 循环播放开关
  onToggleLoop: () => void;
  onPlay: () => void;       // 波形点击/hover 回调：总是播放
  onTogglePlay: () => void; // ▶ 按钮：智能切换播放/暂停
}

/**
 * 播放控制条（替换旧波形图）
 *
 * 布局：竖排
 * - 上：装饰性 SVG 波形（点击/hover 触发 onPlay）
 * - 中：题号 "currentIndex+1 / totalCount"
 * - 下：按钮行（倍速下拉 / 文A 原始 / ▶⏸ / 🔁）
 *
 * 不接：currentTime / duration / loop / 字幕模式
 */
export default function AudioPlayerBar({
  isPlaying,
  currentIndex,
  totalCount,
  speed,
  onSpeedChange,
  isLooping,
  onToggleLoop,
  onPlay,
  onTogglePlay,
}: AudioPlayerBarProps) {
  // 装饰性波形：32 根高度不一的条
  const barHeights = [
    8, 14, 22, 28, 18, 10, 24, 30, 26, 12, 6, 20, 28, 24, 14, 8,
    16, 24, 12, 20, 28, 18, 10, 26, 30, 22, 14, 8, 18, 26, 20, 12,
  ];

  // 倍速下拉弹层
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const speedBtnRef = useRef<HTMLButtonElement>(null);
  const speedMenuRef = useRef<HTMLUListElement>(null);

  // 点击外部 / Esc 关闭弹层
  useEffect(() => {
    if (!speedMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        speedBtnRef.current?.contains(e.target as Node) ||
        speedMenuRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setSpeedMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSpeedMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [speedMenuOpen]);

  return (
    <div className="audio-player-bar" aria-label="播放控制">
      {/* 1. 波形区（点击播放；hover 仅 CSS 视觉反馈，不播音频） */}
      <div
        className="audio-player-bar__waveform"
        role="button"
        tabIndex={0}
        aria-label="点击播放音频"
        onClick={onPlay}
      >
        <svg
          width="100%"
          height="36"
          viewBox="0 0 640 36"
          preserveAspectRatio="none"
          style={{ display: 'block' }}
          className={isPlaying ? 'apb-bars apb-bars--playing' : 'apb-bars'}
        >
          {barHeights.map((h, i) => (
            <rect
              key={i}
              className="apb-bar"
              x={i * 20 + 2}
              y={(36 - h) / 2}
              width="4"
              height={h}
              rx="1"
              fill="currentColor"
              opacity={0.4 + (i % 4) * 0.15}
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animationDelay: `${(i % 8) * 0.08}s`,
              }}
            />
          ))}
        </svg>
      </div>

      {/* 2. 题号（沿用旧 .progress-text 样式） */}
      <span className="progress-text">
        {currentIndex + 1} / {totalCount}
      </span>

      {/* 3. 按钮行：左组 + 主操作 + 右组，竖线分隔 */}
      <div className="audio-player-bar__controls">
        {/* 左组：倍速下拉 + 文A 原始 */}
        <div className="apb__group">
          {/* 倍速下拉触发器 */}
          <button
            ref={speedBtnRef}
            type="button"
            className="apb__btn apb__btn--text apb__btn--speed-trigger"
            data-speed-default={speed === 1}
            aria-label="播放速度"
            aria-haspopup="listbox"
            aria-expanded={speedMenuOpen}
            onClick={() => setSpeedMenuOpen((v) => !v)}
          >
            {speed}x <span className="apb__caret" aria-hidden>▾</span>
          </button>

          {/* 倍速下拉弹层（仅 open 时渲染） */}
          {speedMenuOpen && (
            <ul
              ref={speedMenuRef}
              className="apb__speed-menu"
              role="listbox"
              aria-label="选择播放速度"
            >
              {[0.5, 1, 2].map((s) => (
                <li key={s} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={speed === s}
                    className={`apb__speed-option ${speed === s ? 'is-active' : ''}`}
                    onClick={() => {
                      onSpeedChange(s);
                      setSpeedMenuOpen(false);
                    }}
                  >
                    <span className="apb__speed-option-label">{s}x</span>
                    {speed === s && (
                      <span className="apb__speed-option-check" aria-hidden>✓</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="apb__btn apb__btn--text"
            aria-label="字幕模式"
          >
            文A 原始
          </button>
        </div>

        <span className="apb__divider" aria-hidden />

        {/* 主操作：▶/⏸（stroke SVG，居中布局） */}
        <button
          type="button"
          className="apb__btn apb__btn--play"
          onClick={onTogglePlay}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? (
            <svg className="apb__btn--play-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="9"  y1="6" x2="9"  y2="18" />
              <line x1="15" y1="6" x2="15" y2="18" />
            </svg>
          ) : (
            <svg className="apb__btn--play-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 6 L18 12 L8 18 Z" />
            </svg>
          )}
        </button>

        <span className="apb__divider" aria-hidden />

        {/* 右组：🔁（C 方案：两段 180° 弧 + 两 polyline 箭头，激活时中心加 "1"） */}
        <div className="apb__group">
          <button
            type="button"
            className="apb__btn apb__btn--loop"
            aria-label={isLooping ? '关闭循环' : '循环播放'}
            aria-pressed={isLooping}
            onClick={onToggleLoop}
          >
            <svg
              className="apb__btn--loop-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 12 a9 9 0 0 1 15.5 -6.3" />
              <path d="M21 12 a9 9 0 0 1 -15.5 6.3" />
              <polyline points="21 4 21 9 16 9" />
              <polyline points="3 20 3 15 8 15" />
              {isLooping && (
                <text
                  x="12"
                  y="15.5"
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="currentColor"
                  stroke="none"
                  fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
                >
                  1
                </text>
              )}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
