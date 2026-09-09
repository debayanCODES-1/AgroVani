'use client';

// Client-only context wrapper. QueryClient is created once at module load.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }) {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return <QueryClientProvider client={queryClient}><LanguageProvider>{children}</LanguageProvider></QueryClientProvider>;
}
