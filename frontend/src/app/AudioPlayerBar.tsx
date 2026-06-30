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
  onPlay: () => void;       // 波形点击回调：总是播放
  onTogglePlay: () => void; // ▶ 按钮：智能切换播放/暂停
}

/**
 * 播放控制条 — Apple HIG，web-adapted
 *
 * 布局：竖排
 * - 上：32 根 SVG 波形条（点击 → onPlay；hover 颜色加深；playing 时中性色 + 呼吸）
 * - 中：题号 "{n} / {total}"（JetBrains Mono 等宽）
 * - 下：按钮行（倍速下拉 + 文A 原始（ghost 占位） + 主播放 + 循环）
 *
 * 调色板只用中性 + label 阶；red 留给得分页 enso。
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
  // 装饰性波形：32 根高度不一的条（横向均匀分布）
  const BAR_HEIGHTS = [
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
      {/* 1. 波形（button：可聚焦、可键盘触发） */}
      <button
        type="button"
        className="audio-player-bar__waveform"
        aria-label="点击播放音频"
        onClick={onPlay}
      >
        <svg
          className={
            'audio-player-bar__bars' +
            (isPlaying ? ' audio-player-bar__bars--playing' : '')
          }
          width="100%"
          height="36"
          viewBox="0 0 640 36"
          preserveAspectRatio="none"
          aria-hidden
        >
          {BAR_HEIGHTS.map((h, i) => (
            <rect
              key={i}
              className="audio-player-bar__bar"
              x={i * 20 + 2}
              y={(36 - h) / 2}
              width="4"
              height={h}
              rx="1"
              fill="currentColor"
              style={{ animationDelay: `${(i % 8) * 0.08}s` }}
            />
          ))}
        </svg>
      </button>

      {/* 2. 题号（JetBrains Mono，tabular-nums） */}
      <span
        className="audio-player-bar__progress"
        aria-label={`第 ${currentIndex + 1} 题，共 ${totalCount} 题`}
      >
        {currentIndex + 1} / {totalCount}
      </span>

      {/* 3. 按钮行：左组 + 主操作 + 右组，竖线分隔 */}
      <div className="audio-player-bar__controls">
        {/* 左组：倍速下拉 + 文A 原始（ghost 占位） */}
        <div className="audio-player-bar__group">
          {/* 倍速下拉触发器 */}
          <button
            ref={speedBtnRef}
            type="button"
            className="audio-player-bar__btn audio-player-bar__btn--speed"
            aria-label="播放速度"
            aria-haspopup="listbox"
            aria-expanded={speedMenuOpen}
            onClick={() => setSpeedMenuOpen((v) => !v)}
          >
            <span className="audio-player-bar__speed-label">{speed}x</span>
            <svg
              className="audio-player-bar__caret"
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden
            >
              <path
                d="M2 4 L5 7 L8 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* 倍速下拉弹层（仅 open 时渲染） */}
          {speedMenuOpen && (
            <ul
              ref={speedMenuRef}
              className="audio-player-bar__speed-menu"
              role="listbox"
              aria-label="选择播放速度"
            >
              {[0.5, 1, 2].map((s) => {
                const active = speed === s;
                return (
                  <li key={s} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={
                        'audio-player-bar__speed-option' +
                        (active ? ' audio-player-bar__speed-option--active' : '')
                      }
                      onClick={() => {
                        onSpeedChange(s);
                        setSpeedMenuOpen(false);
                      }}
                    >
                      <span className="audio-player-bar__speed-option-label">{s}x</span>
                      {active && (
                        <svg
                          className="audio-player-bar__speed-option-check"
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          aria-hidden
                        >
                          <path
                            d="M2.5 6.5 L5 9 L9.5 3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 文A 原始：PRD §10 残留 UI —— ghost 样式，aria-disabled，tabIndex=-1 */}
          <button
            type="button"
            className="audio-player-bar__btn audio-player-bar__btn--ghost"
            aria-label="字幕模式（暂不可用）"
            aria-disabled="true"
            tabIndex={-1}
          >
            文A 原始
          </button>
        </div>

        <span className="audio-player-bar__divider" aria-hidden />

        {/* 主操作：▶/⏸（filled 中性圆，无旋转） */}
        <button
          type="button"
          className="audio-player-bar__btn audio-player-bar__btn--play"
          onClick={onTogglePlay}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              aria-hidden
              fill="currentColor"
            >
              <rect x="8" y="6" width="3" height="12" rx="1" />
              <rect x="13" y="6" width="3" height="12" rx="1" />
            </svg>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              aria-hidden
              fill="currentColor"
            >
              <path d="M8 5.2 V18.8 L19 12 Z" />
            </svg>
          )}
        </button>

        <span className="audio-player-bar__divider" aria-hidden />

        {/* 右组：🔁 */}
        <div className="audio-player-bar__group">
          <button
            type="button"
            className={
              'audio-player-bar__btn audio-player-bar__btn--loop' +
              (isLooping ? ' audio-player-bar__btn--active' : '')
            }
            aria-label={isLooping ? '关闭循环' : '循环播放'}
            aria-pressed={isLooping}
            onClick={onToggleLoop}
          >
            <svg
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
                  fontFamily="'JetBrains Mono', 'Fira Code', ui-monospace, monospace"
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