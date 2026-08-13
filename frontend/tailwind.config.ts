import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config = {
  darkMode: ["selector", "[data-theme=dark]"],
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "var(--ds-border)",
        input: "var(--ds-border-strong)",
        ring: "var(--ds-focus)",
        background: "var(--ds-bg)",
        foreground: "var(--ds-ink)",
        primary: {
          DEFAULT: "var(--ds-action-deep)",
          foreground: "var(--ds-on-action)",
        },
        secondary: {
          DEFAULT: "var(--ds-tint)",
          foreground: "var(--ds-ink)",
        },
        destructive: {
          DEFAULT: "var(--ds-error)",
          foreground: "var(--ds-on-cta)",
        },
        muted: {
          DEFAULT: "var(--ds-tint)",
          foreground: "var(--ds-ink-soft)",
        },
        accent: {
          DEFAULT: "var(--ds-tint)",
          foreground: "var(--ds-action-deep)",
        },
        popover: {
          DEFAULT: "var(--ds-surface)",
          foreground: "var(--ds-ink)",
        },
        card: {
          DEFAULT: "var(--ds-surface)",
          foreground: "var(--ds-ink)",
        },
        /* Slate 冷蓝扩展调色板,与 themes.css 的 --ds-action 联动 */
        slate: {
          DEFAULT: "var(--ds-action)",
          deep: "var(--ds-action-deep)",
          soft: "var(--ds-action-soft)",
          tint: "var(--ds-tint)",
        },
        /* Amber 琥珀 CTA 强调色,与 --ds-cta 联动 */
        amber: {
          DEFAULT: "var(--ds-cta)",
          deep: "var(--ds-cta-deep)",
        },
        ink: {
          DEFAULT: "var(--ds-ink)",
          soft: "var(--ds-ink-soft)",
          faint: "var(--ds-ink-faint)",
        },
      },
      fontFamily: {
        sans: "var(--font-sans)",
        display: "var(--font-display)",
        mono: "var(--font-mono)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        elev0: "var(--elev-0)",
        elev1: "var(--elev-1)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        instant: "var(--dur-instant)",
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        breathe: {
          "0%, 100%": { opacity: "0.4", transform: "scale(1)" },
          "50%": { opacity: "0.7", transform: "scale(1.05)" },
        },
        flicker: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.15)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s var(--ease-out)",
        "fade-up": "fade-up 0.5s var(--ease-out)",
        "scale-in": "scale-in 0.3s var(--ease-out)",
        breathe: "breathe 6s ease-in-out infinite",
        flicker: "flicker 2s infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
