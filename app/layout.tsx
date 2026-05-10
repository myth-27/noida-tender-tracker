import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Noida Tender Tracker',
  description: 'Live government tender listings for Noida — scraped daily from UP NIC eProcurement',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-[#09090F] text-white antialiased">{children}</body>
    </html>
  );
}
