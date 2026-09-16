import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ShareButton } from './ShareButton';

// jsdom provides neither API, so every test installs the capabilities it needs.
function stubNavigator(props: { share?: unknown; clipboard?: unknown }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

/** Click and let the async share/copy handler settle before asserting. */
async function clickShare() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  });
}

afterEach(() => {
  for (const key of ['share', 'clipboard']) {
    if (key in navigator) Reflect.deleteProperty(navigator, key);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const props = { title: 'Rust Is the Future', url: 'https://example.test/#/item/1' };

describe('ShareButton', () => {
  it('renders nothing when the platform can neither share nor copy', () => {
    const { container } = render(<ShareButton {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a stable accessible name so the label swap cannot rename it', () => {
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    render(<ShareButton {...props} />);

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('hands the title and URL to the share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    render(<ShareButton {...props} />);

    await clickShare();

    expect(share).toHaveBeenCalledWith(props);
  });

  it('stays silent after a successful share, because the sheet is its own feedback', async () => {
    stubNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    render(<ShareButton {...props} />);

    await clickShare();

    expect(screen.getByText('share')).toBeInTheDocument();
    expect(screen.queryByText('copied')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('confirms visibly and audibly when it falls back to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    render(<ShareButton {...props} />);

    await clickShare();

    expect(writeText).toHaveBeenCalledWith(props.url);
    expect(screen.getByText('copied')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Link copied to clipboard');
  });

  it('reverts the confirmation after it has been read', async () => {
    vi.useFakeTimers();
    stubNavigator({ clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<ShareButton {...props} />);

    await clickShare();
    expect(screen.getByText('copied')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('share')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says nothing when neither route succeeds', async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<ShareButton {...props} />);

    await clickShare();

    expect(screen.getByText('share')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not leave the revert timer running past unmount', async () => {
    vi.useFakeTimers();
    stubNavigator({ clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { unmount } = render(<ShareButton {...props} />);

    await clickShare();
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
