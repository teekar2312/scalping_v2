'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { ReactNode, useEffect } from 'react';
import { useAppStore } from '@/lib/store';

function DensityApplier({ children }: { children: ReactNode }) {
  const density = useAppStore((s) => s.density);

  useEffect(() => {
    const root = document.documentElement;
    root.removeAttribute('data-density');
    root.setAttribute('data-density', density);
  }, [density]);

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <DensityApplier>{children}</DensityApplier>
    </NextThemesProvider>
  );
}
