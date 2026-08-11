import type { ReactNode } from 'react';

/**
 * /me layout — wraps the personal center page with `data-babyblue`
 * scope so the page automatically inherits Baby Blue tokens
 * (matches landing / auth visual language).
 */
export default function MeLayout({ children }: { children: ReactNode }) {
  return <div data-babyblue>{children}</div>;
}