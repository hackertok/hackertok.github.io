import type { ReactNode } from 'react';

/** Shared full-screen panel chrome (full-screen-item + padding). */
export function FullScreenChrome({ children }: { children: ReactNode }) {
  return (
    <div className="full-screen-item">
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}
