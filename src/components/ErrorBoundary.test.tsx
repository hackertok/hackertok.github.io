import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom');
  return <div>child content</div>;
}

// Wrapper that lets tests change resetKey via a button
function ResetKeyHarness({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState('/initial');
  return (
    <>
      <button onClick={() => setKey('/next')}>navigate</button>
      <ErrorBoundary resetKey={key}>{children}</ErrorBoundary>
    </>
  );
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>ok</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('renders error fallback when a child throws', () => {
    // Suppress React's error boundary console noise
    const spy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.queryByText('child content')).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('clears error state when resetKey changes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(vi.fn());

    // Start with a throwing child so the boundary catches an error
    const { rerender } = render(
      <ResetKeyHarness>
        <ThrowingChild shouldThrow />
      </ResetKeyHarness>,
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();

    // Swap to a non-throwing child, then simulate a route change via resetKey
    rerender(
      <ResetKeyHarness>
        <ThrowingChild shouldThrow={false} />
      </ResetKeyHarness>,
    );
    fireEvent.click(screen.getByText('navigate'));

    // Error should be cleared — children render again
    expect(screen.getByText('child content')).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
