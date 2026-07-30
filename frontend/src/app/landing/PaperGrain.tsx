import styles from './PaperGrain.module.css';

/**
 * PaperGrain — hero 背景层
 *
 * 两层装饰,纯静态,SSR-safe:
 *   1. 顶部一抹薄荷径向渐变(mint glow)—— 给 demo 区域一个柔和高光
 *   2. 全幅 paper grain(SVG fractalNoise)—— 纸面颗粒质感,opacity 0.05
 *
 * 之前 ScatteredWords(18 个散落英文单词)被这个组件替代——
 * 单词散落在白底上视觉权重太大,反而让 demo 失焦。
 * PaperGrain 把"纸"的质感保留下来,但完全让出视觉焦点给 demo。
 *
 * 技术:所有图层用 SVG inline data URI,不产生额外网络请求;
 *     mix-blend-mode: multiply 让颗粒只在浅色像素上可见,
 *     不会让 demo 区域也变粗。
 */
export default function PaperGrain() {
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.mintGlow} />
      <div className={styles.grain} />
    </div>
  );
}