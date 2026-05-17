import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui';

/* ── Scene components (animated SVG illustrations) ─────────────────── */

function NotFoundScene({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <svg className="sv-scene" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9.5 12.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" />
        <circle cx="12" cy="19.5" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <div className="sv-scene" style={{ width: 120, height: 120, position: 'relative', animation: 'sv-float-slow 5s ease-in-out infinite' }}>
      {/* Floating particles */}
      <div className="absolute rounded-full bg-accent opacity-35" style={{ width: 4, height: 4, top: 8, right: 10, animation: 'sv-roam-1 7s ease-in-out infinite' }} />
      <div className="absolute rounded-full bg-muted-foreground opacity-35" style={{ width: 3, height: 3, bottom: 15, left: 5, animation: 'sv-roam-2 8s ease-in-out infinite' }} />
      <div className="absolute rounded-full bg-accent opacity-35" style={{ width: 5, height: 5, top: 20, left: 2, animation: 'sv-roam-3 9s ease-in-out infinite' }} />
      <div className="absolute rounded-full bg-muted-foreground opacity-35" style={{ width: 3, height: 3, bottom: 5, right: 0, animation: 'sv-roam-1 6s ease-in-out infinite 1s' }} />
      <div className="absolute rounded-full bg-accent opacity-35" style={{ width: 6, height: 6, top: 0, left: 40, animation: 'sv-roam-2 10s ease-in-out infinite 0.5s' }} />
      {/* Bracket accents */}
      <span className="absolute font-mono text-sm text-muted-foreground opacity-30 font-light" style={{ top: 2, left: 0, animation: 'sv-roam-3 8s ease-in-out infinite' }}>{'{'}</span>
      <span className="absolute font-mono text-sm text-muted-foreground opacity-30 font-light" style={{ bottom: 0, right: 8, animation: 'sv-roam-1 9s ease-in-out infinite 1s' }}>{'}'}</span>
      <span className="absolute font-mono text-sm text-muted-foreground opacity-30 font-light" style={{ top: 40, right: 0, animation: 'sv-roam-2 7s ease-in-out infinite 2s' }}>/</span>
      {/* Main illustration */}
      <svg viewBox="0 0 120 120" fill="none" width="120" height="120" aria-hidden="true">
        <g className="text-muted-foreground" stroke="currentColor">
          <rect x="28" y="16" width="64" height="84" rx="6" strokeWidth="2" />
          <path d="M72 16v20h20" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          <line x1="40" y1="52" x2="68" y2="52" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
          <line x1="40" y1="60" x2="80" y2="60" strokeWidth="2" strokeLinecap="round" opacity="0.15" />
          <line x1="40" y1="68" x2="60" y2="68" strokeWidth="2" strokeLinecap="round" opacity="0.1" />
        </g>
        <g className="text-accent" stroke="currentColor" style={{ animation: 'sv-wiggle 3s ease-in-out infinite', transformOrigin: '60px 48px' }}>
          <path d="M52 38a8 8 0 0 1 16 0c0 6-8 6-8 14" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="60" cy="57" r="1.5" fill="currentColor" stroke="none" />
        </g>
      </svg>
    </div>
  );
}

function ErrorScene({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <svg className="sv-scene" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" className="text-destructive" />
        <line x1="12" y1="9" x2="12" y2="13" className="text-destructive" />
        <circle cx="12" cy="16.5" r="0.5" fill="currentColor" className="text-destructive" />
      </svg>
    );
  }
  return (
    <div className="sv-scene" style={{ width: 120, height: 120, position: 'relative' }}>
      {/* Spark particles */}
      <div className="absolute rounded-full bg-destructive" style={{ width: 3, height: 3, top: 15, right: 12, animation: 'sv-roam-1 5s ease-in-out infinite', opacity: 0.5 }} />
      <div className="absolute rounded-full bg-destructive" style={{ width: 3, height: 3, bottom: 20, left: 8, animation: 'sv-roam-3 6s ease-in-out infinite 0.5s', opacity: 0.4 }} />
      <div className="absolute rounded-full bg-destructive" style={{ width: 3, height: 3, top: 30, left: 15, animation: 'sv-roam-2 7s ease-in-out infinite 1s', opacity: 0.3 }} />
      <div className="absolute rounded-full bg-destructive" style={{ width: 3, height: 3, bottom: 10, right: 20, animation: 'sv-roam-1 5.5s ease-in-out infinite 1.5s', opacity: 0.45 }} />
      {/* Glitch layer 1 (main) */}
      <div className="absolute inset-0">
        <svg viewBox="0 0 120 120" fill="none" width="120" height="120" aria-hidden="true">
          <g className="text-muted-foreground" stroke="currentColor">
            <rect x="16" y="20" width="88" height="76" rx="8" strokeWidth="2" />
            <line x1="16" y1="36" x2="104" y2="36" strokeWidth="1.5" opacity="0.3" />
            <circle cx="28" cy="28" r="3" fill="currentColor" opacity="0.2" />
            <circle cx="38" cy="28" r="3" fill="currentColor" opacity="0.2" />
            <circle cx="48" cy="28" r="3" fill="currentColor" opacity="0.2" />
          </g>
          <g className="text-destructive" fill="currentColor">
            <text x="32" y="55" fontFamily="'SF Mono', 'Fira Code', ui-monospace, monospace" fontSize="11" opacity="0.6">&gt; load</text>
            <text x="32" y="70" fontFamily="'SF Mono', 'Fira Code', ui-monospace, monospace" fontSize="11" fontWeight="bold">ERR!</text>
            <rect x="62" y="62" width="7" height="12" opacity="0.8" style={{ animation: 'sv-blink 1s step-end infinite' }} />
          </g>
        </svg>
      </div>
      {/* Glitch layer 2 */}
      <div className="absolute inset-0" style={{ animation: 'sv-glitch-1 4s ease-in-out infinite', opacity: 0.7 }}>
        <svg viewBox="0 0 120 120" fill="none" width="120" height="120" aria-hidden="true">
          <g className="text-destructive">
            <rect x="16" y="20" width="88" height="76" rx="8" stroke="currentColor" strokeWidth="2" opacity="0.3" />
            <text x="32" y="55" fontFamily="'SF Mono', 'Fira Code', ui-monospace, monospace" fontSize="11" fill="currentColor" opacity="0.4">&gt; load</text>
            <text x="32" y="70" fontFamily="'SF Mono', 'Fira Code', ui-monospace, monospace" fontSize="11" fill="currentColor" opacity="0.6">ERR!</text>
          </g>
        </svg>
      </div>
      {/* Glitch layer 3 */}
      <div className="absolute inset-0" style={{ animation: 'sv-glitch-2 4s ease-in-out infinite 0.1s', opacity: 0.5 }}>
        <svg viewBox="0 0 120 120" fill="none" width="120" height="120" aria-hidden="true">
          <text x="32" y="70" fontFamily="'SF Mono', 'Fira Code', ui-monospace, monospace" fontSize="11" fill="currentColor" className="text-destructive" opacity="0.3">ERR!</text>
        </svg>
      </div>
    </div>
  );
}

function EmptyScene({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <svg className="sv-scene" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" className="text-muted-foreground" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" className="text-muted-foreground" />
        <line x1="12" y1="22.08" x2="12" y2="12" className="text-muted-foreground" />
      </svg>
    );
  }
  return (
    <div className="sv-scene" style={{ width: 120, height: 120, position: 'relative', animation: 'sv-breathe 4s ease-in-out infinite' }}>
      {/* Rising thought dots — start at box opening (y≈55) and float above */}
      <div className="absolute rounded-full bg-accent" style={{ width: 4, height: 4, top: 53, left: 48, animation: 'sv-fade-up 3s ease-out infinite' }} />
      <div className="absolute rounded-full bg-accent" style={{ width: 4, height: 4, top: 53, left: 56, animation: 'sv-fade-up 3s ease-out infinite 0.8s' }} />
      <div className="absolute rounded-full bg-accent" style={{ width: 4, height: 4, top: 53, left: 64, animation: 'sv-fade-up 3s ease-out infinite 1.6s' }} />
      {/* Floating particles */}
      <div className="absolute rounded-full bg-accent opacity-35" style={{ width: 5, height: 5, top: 5, right: 15, animation: 'sv-roam-2 9s ease-in-out infinite' }} />
      <div className="absolute rounded-full bg-muted-foreground opacity-35" style={{ width: 3, height: 3, bottom: 10, left: 10, animation: 'sv-roam-1 7s ease-in-out infinite 1s' }} />
      <div className="absolute rounded-full bg-accent opacity-35" style={{ width: 4, height: 4, top: 15, left: 8, animation: 'sv-roam-3 8s ease-in-out infinite 0.5s' }} />
      {/* Main illustration */}
      <svg viewBox="0 0 120 120" fill="none" width="120" height="120" className="text-muted-foreground" stroke="currentColor" aria-hidden="true">
        <path d="M30 55l30 15 30-15v32L60 117 30 87z" strokeWidth="2" strokeLinejoin="round" opacity="0.5" />
        <path d="M30 55l30 15 30-15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="60" y1="70" x2="60" y2="117" strokeWidth="1.5" opacity="0.3" />
        <path d="M30 55L18 42l30 13" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" style={{ animation: 'sv-wiggle 5s ease-in-out infinite', transformOrigin: '30px 55px' }} />
        <path d="M90 55l12-13-30 13" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" style={{ animation: 'sv-wiggle 5s ease-in-out infinite 0.5s', transformOrigin: '90px 55px' }} />
        <path d="M30 55l18-20 12 10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
        <path d="M90 55l-18-20-12 10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
      </svg>
    </div>
  );
}

function DeletedScene({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <svg className="sv-scene" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" className="text-muted-foreground" />
        <line x1="9" y1="8" x2="15" y2="14" className="text-muted-foreground" />
        <line x1="15" y1="8" x2="9" y2="14" className="text-muted-foreground" />
      </svg>
    );
  }
  return (
    <div className="sv-scene" style={{ width: 120, height: 120, position: 'relative', animation: 'sv-float-slow 6s ease-in-out infinite' }}>
      {/* Dissolving particles */}
      <div className="absolute rounded-full bg-muted-foreground" style={{ width: 4, height: 4, top: 30, left: 55, animation: 'sv-dissolve-up 2.5s ease-out infinite' }} />
      <div className="absolute rounded-full bg-muted-foreground" style={{ width: 3, height: 3, top: 35, left: 45, animation: 'sv-dissolve-up 2.5s ease-out infinite 0.4s' }} />
      <div className="absolute rounded-full bg-muted-foreground" style={{ width: 5, height: 5, top: 28, left: 65, animation: 'sv-dissolve-up 2.5s ease-out infinite 0.8s' }} />
      <div className="absolute rounded-full bg-muted-foreground" style={{ width: 3, height: 3, top: 38, left: 70, animation: 'sv-dissolve-up 2.5s ease-out infinite 1.2s' }} />
      <div className="absolute rounded-full bg-muted-foreground" style={{ width: 4, height: 4, top: 32, left: 50, animation: 'sv-dissolve-up 2.5s ease-out infinite 1.6s' }} />
      <div className="absolute rounded-full bg-muted-foreground" style={{ width: 3, height: 3, top: 40, left: 60, animation: 'sv-dissolve-up 2.5s ease-out infinite 2.0s' }} />
      {/* Main illustration */}
      <svg viewBox="0 0 120 120" fill="none" width="120" height="120" className="text-muted-foreground" stroke="currentColor" aria-hidden="true">
        <path d="M92 60c0-18.78-14.33-34-32-34S28 41.22 28 60c0 11.24 5.94 21.16 15 27.04V104l14.4-10.29C58.9 93.9 60.43 94 62 94c17.67 0 32-15.22 32-34z" strokeWidth="2" strokeLinejoin="round" opacity="0.6" />
        <g opacity="0.3" style={{ animation: 'sv-breathe 3s ease-in-out infinite' }}>
          <line x1="44" y1="52" x2="76" y2="52" strokeWidth="2" strokeLinecap="round" />
          <line x1="44" y1="60" x2="70" y2="60" strokeWidth="2" strokeLinecap="round" />
          <line x1="44" y1="68" x2="64" y2="68" strokeWidth="2" strokeLinecap="round" />
        </g>
        <line x1="42" y1="46" x2="78" y2="74" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
        <line x1="78" y1="46" x2="42" y2="74" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      </svg>
    </div>
  );
}

function EndScene({ compact: _compact }: { compact?: boolean }) {
  return (
    <svg className="sv-scene" width="160" height="12" viewBox="0 0 160 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="6" x2="72" y2="6" className="text-muted-foreground" opacity="0.3" />
      <circle cx="80" cy="6" r="1.5" fill="currentColor" stroke="none" className="text-muted-foreground" opacity="0.4" style={{ transformOrigin: 'center', animation: 'sv-dot-pulse 3s ease-in-out infinite' }} />
      <line x1="88" y1="6" x2="156" y2="6" className="text-muted-foreground" opacity="0.3" />
    </svg>
  );
}

/* ── Scene selector ────────────────────────────────────────────────── */

const SCENES: Record<StateViewProps['variant'], (props: { compact?: boolean }) => React.JSX.Element> = {
  'not-found': NotFoundScene,
  error: ErrorScene,
  empty: EmptyScene,
  deleted: DeletedScene,
  end: EndScene,
};

/* ── Variant defaults ──────────────────────────────────────────────── */

const DEFAULTS: Record<StateViewProps['variant'], { title: string; description: string }> = {
  'not-found': { title: 'Item not found', description: 'This item doesn\'t exist or may have been removed.' },
  error: { title: 'Something went wrong', description: 'We couldn\'t load this content. Please try again.' },
  empty: { title: 'No comments yet.', description: '' },
  deleted: { title: 'Comment deleted', description: 'This was removed by its author or a moderator.' },
  end: { title: '', description: 'You\'ve reached the end' },
};

/* ── StateView component ──────────────────────────────────────────── */

interface StateViewProps {
  variant: 'not-found' | 'error' | 'empty' | 'deleted' | 'end';
  title?: string;
  description?: string;
  action?: {
    label: string;
    to?: string;
    onClick?: () => void;
  };
  compact?: boolean;
  className?: string;
}

export function StateView({ variant, title, description, action, compact, className }: StateViewProps) {
  const defaults = DEFAULTS[variant];
  const resolvedTitle = title ?? defaults.title;
  const resolvedDesc = description ?? defaults.description;
  const Scene = SCENES[variant];

  if (compact) {
    return (
      <div className={className ?? 'flex items-center justify-center gap-3 py-6 text-center'}>
        <Scene compact />
        {resolvedTitle && <span className="text-muted-foreground text-sm">{resolvedTitle}</span>}
        {!resolvedTitle && resolvedDesc && <span className="text-muted-foreground text-sm">{resolvedDesc}</span>}
        {action && <ActionElement action={action} />}
      </div>
    );
  }

  return (
    <div className={className ?? 'flex flex-col items-center justify-center text-center p-6'}>
      <div className="mb-4">
        <Scene />
      </div>
      {resolvedTitle && (
        <h2 className="text-lg font-bold text-foreground mb-1.5">{resolvedTitle}</h2>
      )}
      {resolvedDesc && (
        <p className="text-sm text-muted-foreground max-w-65 pb-7 leading-relaxed">{resolvedDesc}</p>
      )}
      {action && <ActionElement action={action} />}
    </div>
  );
}

function ActionElement({ action }: { action: NonNullable<StateViewProps['action']> }) {
  // RefreshCw icon auto-added to any retry/try-again button.
  const isRetry = /try again|retry/i.test(action.label);
  const buttonContent = (
    <>
      {isRetry && <RefreshCw aria-hidden className="size-3.5" />}
      {action.label}
    </>
  );

  if (action.to) {
    return (
      <Button
        asChild
        variant="default"
        size="sm"
      >
        <Link to={action.to} onClick={action.onClick}>
          {buttonContent}
        </Link>
      </Button>
    );
  }

  if (action.onClick) {
    return (
      <Button variant="default" size="sm" onClick={action.onClick}>
        {buttonContent}
      </Button>
    );
  }

  return null;
}
