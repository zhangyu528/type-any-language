'use client';

/**
 * SettingsTab — preferences + account.
 *
 * Two groups, top to bottom:
 *   偏好 — 主题 / 音频速度 / 默认难度 / 输入时显示音标
 *   账号 — 显示名（来自顶部 AccountCard 的内联编辑）/ 登出
 *   危险区 — 清空本机数据（带二次确认）
 *
 * Each setting reads/writes a single localStorage key. The data
 * consumers are now wired:
 *   - theme → ThemeProvider → 全局 CSS 变量
 *   - audioRate → TranslationStage 的 audioRef.playbackRate（详见
 *     TranslationStage.tsx 中读 prefs.audioRate 的代码）
 *   - defaultDifficulty → landing 拼接 catalog defaults.difficulty 时
 *     优先于 catalog 默认（见 landing/data.ts）
 *   - showPhonetic → 控制 TranslationStage 是否渲染 wordCard 音标
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { useTheme } from '../components/ThemeProvider';
import {
  AudioRate,
  STORAGE_DEFAULT_DIFFICULTY,
  STORAGE_SHOW_PHONETIC,
  clearAllLocalUserData,
  readPrefAudioRate,
  readPrefBool,
  readPrefString,
  removePref,
  writePrefAudioRate,
  writePrefBool,
  writePrefString,
} from '../api';
import ShinyText from '@/components/ShinyText';
import VariableProximity from '@/components/VariableProximity';
import styles from '../me/me-page.module.css';

const AUDIO_RATE_OPTIONS: AudioRate[] = [0.75, 1, 1.25];

export default function SettingsTab() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  // The SettingsTab is signed-in by definition (me-page gates on
  // useAuth). user.id is the real per-user key.
  const userId = user?.id ?? 'anonymous';

  // localStorage → state on mount. SSR-safe: window guard + initial
  // defaults match the persisted defaults so hydration is consistent.
  const [audioRate, setAudioRate] = useState<AudioRate>(1);
  const [defaultDifficulty, setDefaultDifficulty] = useState<string>('');
  const [showPhonetic, setShowPhonetic] = useState<boolean>(true);

  useEffect(() => {
    setAudioRate(readPrefAudioRate());
    setDefaultDifficulty(readPrefString(STORAGE_DEFAULT_DIFFICULTY, ''));
    setShowPhonetic(readPrefBool(STORAGE_SHOW_PHONETIC, true));
  }, []);

  // Persist on change. Guard SSR — the very first render might fire
  // before useEffect has run, so we write only after mount.
  useEffect(() => {
    writePrefAudioRate(audioRate);
  }, [audioRate]);

  useEffect(() => {
    if (defaultDifficulty) {
      writePrefString(STORAGE_DEFAULT_DIFFICULTY, defaultDifficulty);
    } else {
      removePref(STORAGE_DEFAULT_DIFFICULTY);
    }
  }, [defaultDifficulty]);

  useEffect(() => {
    writePrefBool(STORAGE_SHOW_PHONETIC, showPhonetic);
  }, [showPhonetic]);

  // ---- Destructive confirm popovers ----
  // We use small inline confirm cards instead of window.confirm()
  // because window.confirm() is unstyled on every browser, and the
  // me-page visual language warrants a coherent confirm surface.
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [busyAction, setBusyAction] = useState<'logout' | 'reset' | null>(null);

  const onLogout = async () => {
    setBusyAction('logout');
    try {
      await logout();
      router.replace('/');
    } finally {
      setBusyAction(null);
      setConfirmingLogout(false);
    }
  };

  const onReset = async () => {
    if (!userId) return;
    setBusyAction('reset');
    try {
      clearAllLocalUserData(userId);
    } finally {
      setBusyAction(null);
      setConfirmingReset(false);
    }
  };

  return (
    <div className={styles['me-settings']}>
      <section className={styles['me-settings__group']} aria-label="偏好">
        <SettingsKicker>偏好</SettingsKicker>

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
          {/* ME-7: replaced native <select> with the same SegmentedControl
             used by the audio-rate row above. Consistent control
             surface across all settings + theme-aware styling. */}
          <SegmentedControl
            value={defaultDifficulty || 'auto'}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'easy', label: '简单' },
              { value: 'medium', label: '中等' },
              { value: 'hard', label: '困难' },
            ]}
            onChange={(v) => setDefaultDifficulty(v === 'auto' ? '' : v)}
          />
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

      <section className={styles['me-settings__group']} aria-label="账号">
        <SettingsKicker>账号</SettingsKicker>
        <div className={styles['me-settings__actions']}>
          {confirmingLogout ? (
            <ConfirmCard
              title="登出确认"
              hint="登出后会清除当前会话,要重新登录才能继续记录进度。"
              confirmText="登出"
              busy={busyAction === 'logout'}
              onConfirm={() => void onLogout()}
              onCancel={() => setConfirmingLogout(false)}
            />
          ) : (
            <button
              type="button"
              className={`${styles['me-btn']} ${styles['me-btn--destructive']}`}
              onClick={() => setConfirmingLogout(true)}
            >
              登出
            </button>
          )}
        </div>
      </section>

      <section className={styles['me-settings__group']} aria-label="危险区">
        {/* ME-10: tone='destructive' triggers ShinyText in
           --ds-error color so the 危险区 heading visually warns
           the user. */}
        <SettingsKicker tone="destructive">危险区</SettingsKicker>
        <div className={styles['me-settings__actions']}>
          {confirmingReset ? (
            <ConfirmCard
              title="清空本机数据"
              hint="会立即清空本设备的练习进度与收藏夹 — 不会影响你已登录的账号。建议先确认是否还在别处登录。"
              confirmText="清空"
              busy={busyAction === 'reset'}
              onConfirm={() => void onReset()}
              onCancel={() => setConfirmingReset(false)}
            />
          ) : (
            <button
              type="button"
              className={`${styles['me-btn']} ${styles['me-btn--destructive']}`}
              onClick={() => setConfirmingReset(true)}
            >
              清空本机数据
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** VariableProximity kicker — used for SettingsTab section
 *  headings (偏好 / 账号 / 危险区). Matches the StatsTab and
 *  CollectionTab kickers so the /me page has a unified visual
 *  rhythm. */
function SettingsKicker({
  children,
  tone,
}: {
  children: string;
  /** 'destructive' opts into ShinyText in --ds-error color so the
     heading reads as a warning zone. Default renders plain. */
  tone?: 'destructive';
}) {
  return (
    <h2
      className={
        tone === 'destructive'
          ? `${styles['me-section-title']} ${styles['me-section-title--destructive']}`
          : styles['me-section-title']
      }
    >
      {tone === 'destructive' ? (
        <ShinyText
          text={children}
          speed={3}
          color="var(--ds-error)"
          shineColor="var(--ds-cta)"
        />
      ) : (
        <VariableProximity
          label={children}
          fromFontVariationSettings={{ wght: 400 }}
          toFontVariationSettings={{ wght: 700 }}
          radius={80}
          falloff="linear"
          className={styles['me-section-title__prox']}
        />
      )}
    </h2>
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
    <div className={styles['me-settings__row']}>
      <div className={styles['me-settings__row-label']}>{label}</div>
      <div className={styles['me-settings__row-control']}>{children}</div>
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
    <div className={styles['me-segmented']} role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={styles['me-segmented__btn']}
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
      className={styles['me-switch']}
      data-on={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={checked ? labelOn : labelOff}
    >
      <span className={styles['me-switch__thumb']} aria-hidden="true" />
    </button>
  );
}

function ConfirmCard({
  title,
  hint,
  confirmText,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  hint: string;
  confirmText: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles['me-confirm']} role="alertdialog" aria-label={title}>
      <p className={styles['me-confirm__title']}>{title}</p>
      <p className={styles['me-confirm__hint']}>{hint}</p>
      <div className={styles['me-confirm__actions']}>
        <button
          type="button"
          className={`${styles['me-btn']} ${styles['me-btn--ghost']}`}
          onClick={onCancel}
          disabled={busy}
        >
          取消
        </button>
        <button
          type="button"
          className={`${styles['me-btn']} ${styles['me-btn--destructive']}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? '处理中…' : confirmText}
        </button>
      </div>
    </div>
  );
}
