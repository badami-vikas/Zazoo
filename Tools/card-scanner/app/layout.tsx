import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Card Scanner',
  description: 'Scan business cards and save contacts to CSV',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
