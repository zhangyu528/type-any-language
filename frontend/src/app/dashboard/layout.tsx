import type { ReactNode } from 'react';

/**
 * /dashboard layout — wraps the workbench page with `data-babyblue`
 * scope so the page automatically inherits Baby Blue tokens
 * (matches landing / (auth) / me visual language).
 *
 * Token overrides live in src/app/globals.css under
 * `[data-babyblue]` and `[data-theme="dark"] [data-babyblue]` —
 * no per-page palette work needed here.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div data-babyblue>{children}</div>;
}