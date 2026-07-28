'use client';

import { useCallback, useRef, useState } from 'react';
import { getAudioUrl } from '../api';

interface AudioButtonProps {
  /** Full URL (e.g. a COS url) or a relative path under API_BASE_URL. */
  url?: string;
  /** Optional label — renders to the right of the play glyph on non-icon-only
   *  variants. Omit for the icon-only round variant. */
  label?: string;
  /** Visual size. `icon` = 44×44 round button (default for inline play).
   *  `inline` = text-button (label + glyph) for less prominent spots. */
  variant?: 'icon' | 'inline';
  /** Fires after a successful play() call, in case the parent wants to
   *  trigger any side-effect (e.g. tracking). */
  onPlay?: () => void;
  /** Override the auto-detected disabled state. Useful for the
   *  `?lib=recommended` path before we know whether audio exists. */
  forceDisabled?: boolean;
}

/**
 * AudioButton — small play-button primitive.
 *
 * Wraps a single hidden `<audio>` element and exposes a clickable affordance
 * (icon-only round button, or inline text+glyph button). Tap (or Enter /
 * Space) replays from the start. We deliberately swallow autoplay-policy
 * rejections silently — the same pattern the existing TranslationStage
 * uses — so a blocked autoplay doesn't surface as a console error.
 *
 * Accessibility: the button is a real `<button>`; `aria-label` defaults
 * to "播放" / "重新播放" based on playing state. Space-key is NOT
 * captured here so the global Stage-level Space=play shortcut keeps
 * working when a parent component owns the Space binding.
 */
export default function AudioButton({
  url,
  label,
  variant = 'icon',
  onPlay,
  forceDisabled,
}: AudioButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const disabled = forceDisabled || !url;

  const play = useCallback(() => {
    if (!url) return;
    try {
      const el =
        audioRef.current ??
        (() => {
          const created = new Audio();
          audioRef.current = created;
          return created;
        })();
      el.src = getAudioUrl(url);
      el.currentTime = 0;
      setIsPlaying(true);
      el.play()
        .then(() => {
          onPlay?.();
        })
        .catch(() => {
          // Autoplay blocked, network, etc — silent.
          setIsPlaying(false);
        });
      el.onended = () => setIsPlaying(false);
      el.onerror = () => setIsPlaying(false);
    } catch {
      setIsPlaying(false);
    }
  }, [url, onPlay]);

  const className =
    'audio-button' +
    (variant === 'inline' ? ' audio-button--inline' : '') +
    (isPlaying ? ' audio-button--playing' : '');

  return (
    <button
      type="button"
      className={className}
      onClick={play}
      disabled={disabled}
      aria-label={isPlaying ? '重新播放' : '播放'}
      title={disabled ? '暂无音频' : isPlaying ? '重新播放' : '播放'}
    >
      <span className="audio-button__glyph" aria-hidden>
        {isPlaying ? '◐' : '▶'}
      </span>
      {label && <span className="audio-button__label">{label}</span>}
    </button>
  );
}
