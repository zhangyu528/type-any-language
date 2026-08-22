'use client';

import Link from 'next/link';
import styles from './privacy.module.css';

const LAST_UPDATED = '2026 年 8 月 20 日';
const EFFECTIVE = '2026 年 8 月 20 日';

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <Link href="/" className={styles.backLink} aria-label="返回首页">
          <span aria-hidden="true">←</span>
          返回首页
        </Link>

        <header className={styles.header}>
          <p className={styles.eyebrow}>LEGAL · 隐私政策</p>
          <h1 className={styles.title}>隐私政策</h1>
          <p className={styles.meta}>
            最后更新: {LAST_UPDATED} · 生效日期: {EFFECTIVE}
          </p>
        </header>

        <p className={styles.tldr}>
          <strong>TL;DR</strong>:我们只收集你主动提供的邮箱(注册用)和你在练习过程中产生的学习数据(练习进度、错词本)。数据加密存储,我们不出售也不分享给第三方。你随时可以查看、修改或删除。
        </p>

        <div className={styles.body}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>1. 我们收集的信息</h2>
            <p className={styles.paragraph}>我们收集以下三类信息:</p>
            <dl className={styles.kvTable}>
              <dt>账户信息</dt>
              <dd>邮箱地址、密码(经过哈希处理,非明文)、注册时间。</dd>
              <dt>学习数据</dt>
              <dd>练习过的词库、每个句子的输入记录、错词本、累计练习时长、累计正确率等进度信息。</dd>
              <dt>技术信息</dt>
              <dd>设备类型、浏览器版本、IP 地址(仅用于安全审计,30 天后自动删除)。</dd>
            </dl>
            <p className={styles.paragraph}>
              我们<strong>不</strong>收集:真实姓名(注册不需要)、手机号、地理位置(精确到城市以下)、通讯录、相册、麦克风内容。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>2. 我们如何使用信息</h2>
            <p className={styles.paragraph}>收集的信息仅用于:</p>
            <ul className={styles.list}>
              <li>提供核心学习功能(账号登录、进度同步、错词本)</li>
              <li>改进练习体验(根据你的错词类型调整复习频率)</li>
              <li>异常检测与安全审计(防止刷号、撞库)</li>
              <li>故障排查与产品改进(聚合统计数据,不可关联到个人)</li>
            </ul>
            <p className={styles.paragraph}>
              我们<strong>不</strong>用于:广告投放、用户画像出售、行为追踪、第三方营销。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>3. 数据存储与安全</h2>
            <p className={styles.paragraph}>你的数据存储在加密的云端数据库中,采用以下保护措施:</p>
            <ul className={styles.list}>
              <li>密码使用 bcrypt 哈希存储,不可明文读取</li>
              <li>数据库连接强制 TLS 加密</li>
              <li>所有 API 端点需要认证(基于 HttpOnly Cookie)</li>
              <li>定期安全审计与漏洞扫描</li>
            </ul>
            <p className={styles.paragraph}>
              即便如此,没有任何系统能做到 100% 安全。如发生数据泄露,我们会在 72 小时内通知你。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>4. 第三方服务</h2>
            <p className={styles.paragraph}>本服务依赖以下第三方基础设施:</p>
            <ul className={styles.list}>
              <li>云数据库(用于存储你的账户与学习数据)</li>
              <li>CDN / 静态资源托管(用于加速页面加载)</li>
            </ul>
            <p className={styles.paragraph}>
              这些服务提供商仅在必要的范围内接触你的数据(例如数据库提供商需要存储数据),不会用于自己的营销目的。我们不与广告网络、分析追踪商共享你的个人数据。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>5. 你的权利</h2>
            <p className={styles.paragraph}>你对自己的数据拥有以下权利,可在账户设置中随时行使:</p>
            <ul className={styles.list}>
              <li><strong>查看</strong>:导出你的全部学习数据(JSON / CSV)</li>
              <li><strong>修改</strong>:更新邮箱、修改密码</li>
              <li><strong>删除</strong>:注销账户,所有个人数据 30 天内从生产库清除(备份保留 90 天后销毁)</li>
              <li><strong>导出</strong>:标准数据导出,可迁移到其他服务</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>6. Cookie 与本地存储</h2>
            <p className={styles.paragraph}>
              本服务使用以下 Cookie / localStorage:
            </p>
            <dl className={styles.kvTable}>
              <dt>认证 Cookie</dt>
              <dd>用于保持登录状态(HttpOnly + Secure,前端无法读取)</dd>
              <dt>主题选择</dt>
              <dd>localStorage 键 <code>landing.theme</code>,记录 light / dark 偏好</dd>
              <dt>学习进度缓存</dt>
              <dd>localStorage 临时缓存未同步的练习记录,登录同步后清除</dd>
            </dl>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>7. 未成年人</h2>
            <p className={styles.paragraph}>
              本服务面向 13 岁以上用户。13 岁以下儿童不应注册使用。如发现 13 岁以下儿童误注册,我们会在收到通知后 7 天内删除其账户与所有数据。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>8. 政策变更</h2>
            <p className={styles.paragraph}>
              我们可能根据法律变更或业务调整更新本政策。重大变更(例如数据用途变化)会通过站内通知或邮件告知,继续使用即视为接受。
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>9. 联系方式</h2>
            <p className={styles.paragraph}>
              如对本政策有任何疑问,或希望行使你的数据权利(查看、修改、删除),可通过邮件联系我们:
            </p>
            <p className={styles.paragraph}>
              <code>hi@type-any-language.dev</code>
            </p>
          </section>
        </div>

        <footer className={styles.footer}>
          <span>© 2026 Type Any Language</span>
          <Link href="/terms" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
            服务条款
          </Link>
        </footer>
      </article>
    </main>
  );
}
