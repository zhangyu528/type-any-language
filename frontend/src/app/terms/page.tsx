'use client';

import Link from 'next/link';
import styles from './terms.module.css';

const LAST_UPDATED = '2026 年 8 月 20 日';
const EFFECTIVE = '2026 年 8 月 20 日';

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <Link href="/" className={styles.backLink} aria-label="返回首页">
          <span aria-hidden="true">←</span>
          返回首页
        </Link>

        <header className={styles.header}>
          <p className={styles.eyebrow}>LEGAL · 服务条款</p>
          <h1 className={styles.title}>服务条款</h1>
          <p className={styles.meta}>
            最后更新: {LAST_UPDATED} · 生效日期: {EFFECTIVE}
          </p>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>1. 接受条款</h2>
            <p className={styles.paragraph}>
              欢迎使用 <strong>Type Any Language</strong>(以下简称"本服务"或"我们")。在访问或使用本服务前,请仔细阅读本服务条款。一旦你注册账户、登录或以任何方式使用本服务,即表示你已阅读、理解并同意接受本条款的全部约束。如果你不同意任何条款,请立即停止使用本服务。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>2. 服务内容</h2>
            <p className={styles.paragraph}>
              本服务是一个面向中文母语者的英语学习训练平台。核心功能包括:
            </p>
            <ul className={styles.list}>
              <li>基于词库的逐句跟打练习 —— 听原音、键入英文、即时反馈</li>
              <li>错词自动收集与重练,形成个人错词本</li>
              <li>多档词库(A1 入门到 C1 雅思)分级训练</li>
              <li>学习进度云端同步(需登录)</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>3. 用户账户</h2>
            <p className={styles.paragraph}>使用本服务的完整功能需要注册账户。你需要:</p>
            <ul className={styles.list}>
              <li>提供真实、准确、完整的注册信息</li>
              <li>妥善保管账户密码,不与他人共享</li>
              <li>对账户下发生的所有活动负责</li>
              <li>发现未授权使用时立即通知我们</li>
            </ul>
            <p className={styles.paragraph}>
              我们保留在合理怀疑时暂停或终止账户的权利,包括但不限于违反本条款、长期不活跃或可疑活动等情况。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>4. 知识产权</h2>
            <p className={styles.paragraph}>
              本服务提供的所有内容,包括但不限于词库文本、音频、UI 设计、代码、文档、品牌标识,均归我们或我们的许可方所有,受著作权法保护。
            </p>
            <p className={styles.paragraph}>
              在使用本服务过程中,<strong>你输入的英文句子</strong>和<strong>产生的错词记录</strong>归你所有。我们仅在你授权的范围内使用这些数据(详见 <Link href="/privacy" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>隐私政策</Link>)。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>5. 免责声明</h2>
            <p className={styles.paragraph}>本服务按"现状"提供。我们不对以下情况承担责任:</p>
            <ul className={styles.list}>
              <li>服务中断、数据丢失或其他技术故障</li>
              <li>用户因使用本服务而产生的任何间接、偶然或衍生损失</li>
              <li>第三方内容(包括词库数据)的准确性与完整性</li>
            </ul>
            <p className={styles.paragraph}>
              在法律允许的最大范围内,我们对本服务的总责任不超过你在过去 12 个月内为本服务支付的金额(如有)。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>6. 条款变更</h2>
            <p className={styles.paragraph}>
              我们可能根据业务发展或法律要求不时更新本条款。条款变更后,我们会通过站内通知或邮件告知。继续使用本服务即视为接受变更后的条款。如果你不同意变更,请停止使用本服务并可选择注销账户。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>7. 终止</h2>
            <p className={styles.paragraph}>
              你可以随时通过账户设置注销账户。我们也会在合理情况下保留终止账户的权利(参见第 3 条)。账户终止后,你的个人数据将按照 <Link href="/privacy" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>隐私政策</Link> 处理。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>8. 联系方式</h2>
            <p className={styles.paragraph}>
              如对本条款有任何疑问,可通过邮件联系我们:
            </p>
            <p className={styles.paragraph}>
              <code>hi@type-any-language.dev</code>
            </p>
          </section>
        </div>

        <footer className={styles.footer}>
          <span>© 2026 Type Any Language</span>
          <Link href="/privacy" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
            隐私政策
          </Link>
        </footer>
      </article>
    </main>
  );
}
