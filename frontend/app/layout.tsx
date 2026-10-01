import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { SessionProvider } from '@/components/Session';

export const metadata: Metadata = {
  title: 'Refund Desk',
  description: 'AI-assisted refund request handling',
};

// viewport-fit=cover lets the layout use env(safe-area-inset-*) around the notch and home indicator.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#171a21' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Nav />
          <main className="page">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
