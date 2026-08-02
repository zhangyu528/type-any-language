'use client';

/**
 * SettingsTab — preferences + account.
 *
 * Two groups, top to bottom:
 *   偏好 — 主题 / 音频速度 / 默认难度 / 输入时显示音标
 *   账号 — 登出
 *
 * Each setting reads/writes a single localStorage key. The data
 * consumer (LandingPage for defaultDifficulty; TranslationStage for
 * audioRate) is not yet wired in this MVP — the keys are persisted
 * so the next phase can pick them up. That's intentional: shipping
 * the surface without the consumer would be lying about behaviour.
 * Documented inline below.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { useTheme } from '../components/ThemeProvider';

const STORAGE_AUDIO_RATE = 'prefs.audioRate';
const STORAGE_DEFAULT_DIFFICULTY = 'prefs.defaultDifficulty';
const STORAGE_SHOW_PHONETIC = 'prefs.showPhonetic';

const AUDIO_RATE_OPTIONS = [0.75, 1, 1.25] as const;
type AudioRate = (typeof AUDIO_RATE_OPTIONS)[number];

function readStoredAudioRate(): AudioRate {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = window.localStorage.getItem(STORAGE_AUDIO_RATE);
    const n = raw == null ? NaN : Number(raw);
    if (n === 0.75 || n === 1 || n === 1.25) return n;
  } catch {
    /* 隐私模式静默 */
  }
  return 1;
}

function readStoredString(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* 隐私模式静默 */
  }
  return fallback;
}

export default function SettingsTab() {
  const router = useRouter();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();

  // localStorage → state on mount. SSR-safe: window guard + initial
  // defaults match the persisted defaults so hydration is consistent.
  const [audioRate, setAudioRate] = useState<AudioRate>(1);
  const [defaultDifficulty, setDefaultDifficulty] = useState<string>('');
  const [showPhonetic, setShowPhonetic] = useState<boolean>(true);

  useEffect(() => {
    setAudioRate(readStoredAudioRate());
    setDefaultDifficulty(readStoredString(STORAGE_DEFAULT_DIFFICULTY, ''));
    setShowPhonetic(readStoredBool(STORAGE_SHOW_PHONETIC, true));
  }, []);

  // Persist on change. Guard SSR — the very first render might fire
  // before useEffect has run, so we write only after mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_AUDIO_RATE, String(audioRate));
    } catch {
      /* 隐私模式静默 */
    }
  }, [audioRate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (defaultDifficulty) {
        window.localStorage.setItem(STORAGE_DEFAULT_DIFFICULTY, defaultDifficulty);
      } else {
        window.localStorage.removeItem(STORAGE_DEFAULT_DIFFICULTY);
      }
    } catch {
      /* 隐私模式静默 */
    }
  }, [defaultDifficulty]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_SHOW_PHONETIC, String(showPhonetic));
    } catch {
      /* 隐私模式静默 */
    }
  }, [showPhonetic]);

  const onLogout = async () => {
    if (typeof window === 'undefined') return;
    const confirmed = window.confirm('确定要登出吗？');
    if (!confirmed) return;
    await logout();
    router.replace('/');
  };

  return (
    <div className="me-settings">
      <section className="me-settings__group" aria-label="偏好">
        <h2 className="me-section-title">偏好</h2>

        <SettingRow label="主题">
          <SegmentedControl
            value={theme}
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            onChange={(v) => setTheme(v as 'light' | 'dark')}
          />
        </SettingRow>

        <SettingRow label="音频播放速度">
          <SegmentedControl
            value={String(audioRate)}
            options={AUDIO_RATE_OPTIONS.map((r) => ({
              value: String(r),
              label: `${r}×`,
            }))}
            onChange={(v) => setAudioRate(Number(v) as AudioRate)}
          />
        </SettingRow>

        <SettingRow label="默认难度">
          <select
            value={defaultDifficulty}
            onChange={(e) => setDefaultDifficulty(e.target.value)}
            className="me-select"
            aria-label="默认难度"
          >
            <option value="">跟随词库默认</option>
            <option value="easy">简单</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
        </SettingRow>

        <SettingRow label="输入时显示音标">
          <Switch
            checked={showPhonetic}
            onChange={setShowPhonetic}
            labelOn="显示"
            labelOff="隐藏"
          />
        </SettingRow>
      </section>

      <section className="me-settings__group" aria-label="账号">
        <h2 className="me-section-title">账号</h2>
        <div className="me-settings__actions">
          <button
            type="button"
            className="me-btn me-btn--destructive"
            onClick={() => void onLogout()}
          >
            登出
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="me-settings__row">
      <div className="me-settings__row-label">{label}</div>
      <div className="me-settings__row-control">{children}</div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="me-segmented" role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="me-segmented__btn"
          data-active={value === opt.value ? 'true' : 'false'}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value ? 'true' : 'false'}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  labelOn,
  labelOff,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      className="me-switch"
      data-on={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={checked ? labelOn : labelOff}
    >
      <span className="me-switch__thumb" aria-hidden="true" />
    </button>
  );
}