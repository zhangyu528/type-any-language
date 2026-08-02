import type { Metadata } from 'next';
import Button from '../ds/components/Button';
import BubbleCard from '../ds/components/BubbleCard';
import KeyCap from '../ds/components/KeyCap';
import Badge from '../ds/components/Badge';
import Stat from '../ds/components/Stat';
import TypedText from '../ds/components/TypedText';
import Waveform from '../ds/components/Waveform';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'TAL Mint · 设计系统' };

/* ------------------------------------------------------------
 * /design-system — TAL Mint 设计系统陈列页(活文档 + 验收标准)
 *
 * 只读语义 token(--ds-*)。新增 token / 组件时必须先在此页
 * 登记并验收,再进业务页面。
 * ---------------------------------------------------------- */

const swatches: Array<{ name: string; token: string; note?: string }> = [
  { name: 'bg', token: '--ds-bg', note: '页面底' },
  { name: 'surface', token: '--ds-surface', note: '白卡片' },
  { name: 'tint', token: '--ds-tint', note: 'chip/轨道' },
  { name: 'border', token: '--ds-border' },
  { name: 'ink', token: '--ds-ink', note: '正文' },
  { name: 'ink-soft', token: '--ds-ink-soft' },
  { name: 'ink-faint', token: '--ds-ink-faint' },
  { name: 'action', token: '--ds-action', note: '填充·禁小字' },
  { name: 'action-deep', token: '--ds-action-deep', note: '文字级' },
  { name: 'action-ink', token: '--ds-action-ink', note: '标题级' },
  { name: 'correct', token: '--ds-correct' },
  { name: 'error', token: '--ds-error', note: '大字/图标' },
  { name: 'error-ink', token: '--ds-error-ink', note: '小字错误' },
  { name: 'cta', token: '--ds-cta', note: '一页一处' },
  { name: 'focus', token: '--ds-focus', note: 'focus 环' },
];

const typeRows: Array<{ cls: string; label: string; spec: string; sample: string }> = [
  { cls: styles.tDisplay, label: 'display', spec: '28/1.2 ·500 ·-0.5px', sample: '听音写句' },
  { cls: styles.tH1, label: 'h1', spec: '20/1.3 ·500', sample: '今日三件事' },
  { cls: styles.tH2, label: 'h2', spec: '16/1.4 ·500', sample: '词库市场' },
  { cls: styles.tBody, label: 'body', spec: '14/1.6 ·400', sample: '语料取自日常场景,不是课本例句。' },
  { cls: styles.tCaption, label: 'caption', spec: '12/1.5 ·400', sample: '进行中 · 62% 完成' },
  { cls: styles.tTyping, label: 'typing', spec: '16/1.8 ·mono', sample: 'I drink coffee every morning.' },
];

const spaceRows = [
  { token: '--space-1', px: 4, use: '图标间距' },
  { token: '--space-2', px: 8, use: '元素间' },
  { token: '--space-3', px: 12, use: '紧凑内距' },
  { token: '--space-4', px: 16, use: '卡片内边距' },
  { token: '--space-5', px: 24, use: '卡片组' },
  { token: '--space-6', px: 40, use: '段落间' },
  { token: '--space-7', px: 64, use: '幕间距' },
];

const radiusRows = [
  { token: '--radius-sm', use: '小件 / 键帽' },
  { token: '--radius-md', use: '输入框' },
  { token: '--radius-lg', use: '卡片' },
  { token: '--radius-xl', use: '大幕卡' },
  { token: '--radius-pill', use: '按钮 / chip' },
];

export default function DesignSystemPage() {
  return (
    <main className={styles.root}>
      <header className={styles.head}>
        <p className={styles.kicker}>TAL Mint · design system</p>
        <h1 className={styles.title}>设计系统陈列页</h1>
        <p className={styles.hint}>
          全部取值来自语义 token(--ds-*)。组件与页面只允许消费这些变量;
          hex 的唯一出处是 ds/tokens.css。
        </p>
      </header>

      <section className={styles.section} aria-label="色彩">
        <h2 className={styles.h2}>color/*</h2>
        <div className={styles.swatchGrid}>
          {swatches.map((s) => (
            <div key={s.name} className={styles.swatch}>
              <span
                className={styles.swatchChip}
                style={{ background: `var(${s.token})` }}
              />
              <span className={styles.swatchName}>{s.name}</span>
              {s.note ? <span className={styles.swatchNote}>{s.note}</span> : null}
            </div>
          ))}
        </div>
        <p className={styles.rule}>
          对比度规则:--ds-action / --ds-error 只用于填充、图标、大字;
          小字薄荷用 --ds-action-deep,小字错误用 --ds-error-ink。
        </p>
      </section>

      <section className={styles.section} aria-label="字阶">
        <h2 className={styles.h2}>type/*</h2>
        <div className={styles.typeList}>
          {typeRows.map((t) => (
            <div key={t.label} className={styles.typeRow}>
              <span className={`${t.cls} ${styles.typeSample}`}>{t.sample}</span>
              <span className={styles.typeSpec}>
                {t.label} · {t.spec}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-label="间距">
        <h2 className={styles.h2}>space/* · 4px 基网</h2>
        <div className={styles.spaceList}>
          {spaceRows.map((s) => (
            <div key={s.token} className={styles.spaceRow}>
              <span
                className={styles.spaceBar}
                style={{ width: `var(${s.token})` }}
              />
              <span className={styles.typeSpec}>
                {s.token} · {s.px}px · {s.use}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-label="圆角">
        <h2 className={styles.h2}>radius/* · 气泡圆角</h2>
        <div className={styles.radiusRow}>
          {radiusRows.map((r) => (
            <div key={r.token} className={styles.radiusItem}>
              <span
                className={styles.radiusBox}
                style={{ borderRadius: `var(${r.token})` }}
              />
              <span className={styles.typeSpec}>{r.token}</span>
              <span className={styles.swatchNote}>{r.use}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-label="层级与聚焦">
        <h2 className={styles.h2}>elevate/* + focus</h2>
        <div className={styles.elevRow}>
          <span className={styles.elevCard}>e0 描边卡</span>
          <span className={styles.elevCard} style={{ boxShadow: 'var(--elev-1)' }}>
            e1 浮起
          </span>
          <span className={styles.elevCard} style={{ boxShadow: 'var(--elev-focus)' }}>
            focus 环
          </span>
        </div>
      </section>

      <section className={styles.section} aria-label="打字字符五态">
        <h2 className={styles.h2}>char/* · 打字字符五态</h2>
        <p className={styles.charDemo}>
          <span style={{ color: 'var(--ds-char-correct)' }}>typed</span>
          <span
            style={{
              color: 'var(--ds-char-error)',
              borderBottom: '2px solid var(--ds-char-error-line)',
            }}
          >
            x
          </span>
          <span style={{ color: 'var(--ds-char-untyped)' }}>rest</span>
          <span className={styles.caret} />
        </p>
        <p className={styles.rule}>
          correct=--ds-char-correct · error=--ds-char-error +
          --ds-char-error-line 下划线 · untyped=--ds-char-untyped ·
          caret=--ds-caret(圆头 2px)
        </p>
      </section>

      <section className={styles.section} aria-label="控件尺寸">
        <h2 className={styles.h2}>size/* · 触控 ≥44</h2>
        <div className={styles.sizeRow}>
          <span className={styles.btnSm}>sm/32</span>
          <span className={styles.btnMd}>md/40</span>
          <span className={styles.btnLg}>lg/48 CTA</span>
          <span className={styles.inputDemo}>input/44</span>
        </div>
      </section>

      <section className={styles.section} aria-label="动效">
        <h2 className={styles.h2}>motion/*</h2>
        <p className={styles.rule}>
          spring.overshoot(stiffness 260 / damping 20)= Q 弹,用于卡片入场与按钮;
          spring.soft(120/24)= 幕间 reveal;spring.counter(300/30)= 数字翻滚。
          prefers-reduced-motion 全局降级为 150ms 淡入(见 ds/motion.ts)。
        </p>
      </section>

      <section className={styles.section} aria-label="组件">
        <h2 className={styles.h2}>components/*</h2>

        <h3 className={styles.h3}>Button</h3>
        <div className={styles.compRow}>
          <Button variant="primary" size="sm">primary/sm</Button>
          <Button variant="primary">primary/md</Button>
          <Button variant="cta" size="lg">cta/lg · 一页一处</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="primary" loading>
            提交中
          </Button>
          <Button variant="primary" disabled>
            disabled
          </Button>
        </div>

        <h3 className={styles.h3}>TypedText · 字符五态</h3>
        <BubbleCard className={styles.compCard}>
          <TypedText
            text="I drink coffee every morning."
            states={[
              'correct','correct','correct','correct','correct','correct',
              'error',
              'correct','correct','correct','correct','correct',
              'untyped','untyped','untyped','untyped','untyped','untyped',
              'untyped','untyped','untyped','untyped','untyped','untyped',
              'untyped','untyped','untyped','untyped','untyped',
            ]}
            caret={13}
          />
        </BubbleCard>

        <h3 className={styles.h3}>Waveform / KeyCap / Badge / Stat</h3>
        <div className={styles.compRow}>
          <Waveform playing bars={20} />
          <KeyCap>⏎ enter</KeyCap>
          <KeyCap>esc</KeyCap>
          <Badge>02 · 怎么练</Badge>
          <Badge tone="coral">12 句待复习</Badge>
          <Stat value="64" label="wpm" />
          <Stat value="62%" label="雅思核心" tone="mint" />
          <Stat value="12" label="错题" tone="coral" />
        </div>

        <h3 className={styles.h3}>BubbleCard</h3>
        <div className={styles.compRow}>
          <BubbleCard className={styles.compCard}>
            静态卡(e0 描边)
          </BubbleCard>
          <BubbleCard interactive className={styles.compCard}>
            可交互卡 · hover 浮起
          </BubbleCard>
        </div>
      </section>
    </main>
  );
}
