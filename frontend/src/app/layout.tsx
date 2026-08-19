import { Fraunces, JetBrains_Mono, Noto_Sans_SC } from 'next/font/google';
import ThemeProvider from './components/ThemeProvider';
import { AuthProvider } from './lib/auth';
import { AuthModalProvider } from './lib/authModal';
import AuthModal from './(auth)/_components/AuthModal';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  // NO `weight` array — that pins us to static font files and breaks
  // `font-variation-settings`. Without it, next/font pulls the variable
  // file and lets us interpolate the `wght` / `opsz` axes at runtime
  // (used by VariableProximity on the section kickers).
  variable: '--font-display',
  display: 'swap',
});

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans-zh',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  // Same fix as Fraunces above: no `weight` array → variable font file →
  // VariableProximity's `wght` interpolation actually takes effect.
  variable: '--font-mono-web',
  display: 'swap',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${fraunces.variable} ${notoSansSC.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <title>Type Any Language</title>
        {/*
          All webfonts are loaded via next/font/google (above). The
          resulting CSS variables --font-display, --font-sans-zh,
          --font-mono-web are exposed on <html> and consumed inside
          globals.css / per-component stylesheets.

          Pre-paint theme bootstrap: before React hydrates, ThemeProvider
          may have already set data-theme on <html>. To prevent the
          browser from flashing the wrong theme on first paint, we read
          localStorage here and apply it synchronously. This MUST run
          before any rendered DOM touches the bg.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('landing.theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';try{localStorage.setItem('landing.theme',t);}catch(_){}}document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <AuthModalProvider>
              {children}
              <AuthModal />
            </AuthModalProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}