import AppHeader from './components/AppHeader';
import { AuthProvider } from './lib/auth';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <title>Type Any Language</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          Body/display family uses the platform system font stack
          (SF Pro on macOS/iOS, Segoe UI Variable on Windows, Roboto
          on Android/Linux) — declared in globals.css :root as
          --font-body. No webfont needed.

          JetBrains Mono is the only webfont, used for IPA phonetics
          and code-like chips. Fira Code and ui-monospace are the
          fallbacks declared in --font-mono.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* AuthProvider wraps everything (including the chrome) so
            AppHeader can call useAuth() to swap login pill ↔ avatar
            based on the cookie-derived `user` state. Without this
            wrapper, AppHeader would render before the provider
            hydrates and throw "useAuth must be used inside
            <AuthProvider>". */}
        <AuthProvider>
          {/* Global top chrome. Self-hides on /login + /signup via
              usePathname — those pages have their own brand link
              inside the aurora glass card. */}
          <AppHeader />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
