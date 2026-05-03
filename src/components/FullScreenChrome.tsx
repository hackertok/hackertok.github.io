import type { ReactNode } from 'react';

/**
 * Shared outer wrapper for a full-screen item or comment panel.
 * Centralises the `full-screen-item` + `px-4 py-4` chrome that
 * `FullScreenItem`, `FullScreenComment`, and their `*SkeletonPanel`
 * helpers all wrap their content in. Keeping this in one place
 * prevents the gutter from drifting between bare-context skeletons
 * and post-load renders (the original drift bug that motivated the
 * `*SkeletonPanel` split — see those components' header comments).
 */
export function FullScreenChrome({ children }: { children: ReactNode }) {
  return (
    <div className="full-screen-item">
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}
