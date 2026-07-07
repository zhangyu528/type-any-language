import Home from './page';
import './globals.css';
import { AuthProvider } from './lib/auth';
import { Header } from './components/Header';

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
        {/*
          AuthProvider wraps the whole tree so Header can call useAuth().
          Header sits above children — practice + auth + history pages
          all get the same top bar. The (auth) route group's own layout
          still wins for /login + /signup because nested layouts override.
        */}
        <AuthProvider>
          <Header />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}