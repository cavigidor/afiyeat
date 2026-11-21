import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewListSheet } from '@/components/lists/v2/NewListSheet';
import { createListFromPreset, savePresetFields } from '@/lib/listCreate';
import { toast } from 'sonner';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/hooks/useMyShareIdentity', () => ({ useMyShareIdentity: () => ({ referralCode: null, isPrivate: false }) }));
vi.mock('@/lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/listCreate', () => ({ createListFromPreset: vi.fn(), savePresetFields: vi.fn() }));

function renderSheet() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NewListSheet open onOpenChange={vi.fn()} existingNames={['Movies']} onBlankList={vi.fn()} onSharedList={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

describe('NewListSheet', () => {
  beforeEach(() => vi.mocked(createListFromPreset).mockReset());

  it('shows Movies among the six main presets and Coffee Shops under More presets', async () => {
    renderSheet();
    const main = screen.getByText('Pick a starting point. Everything can be changed later.').parentElement!;
    const tiles = within(main).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(tiles.slice(0, 6)).toEqual(['Restaurants', 'Drinks', 'Coffee Beans', 'Movies', 'Stores', 'Travel']);
    expect(screen.queryByRole('button', { name: 'Coffee Shops' })).toBeNull();
    expect(screen.getByText('Coffee Shops, Shows, Books, Concerts, Wines, Beers')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'More presets' }));
    expect(screen.getByRole('button', { name: 'Coffee Shops' })).toBeTruthy();
  });

  it('choosing a preset does not focus the name field (no keyboard until the person taps it)', async () => {
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
    await nextFrame();
    await nextFrame();
    const input = screen.getByLabelText('List name') as HTMLInputElement;
    expect(input.value).toBe('Movies 2');
    expect(document.activeElement).not.toBe(input);
    // Nothing that raises the iPhone keyboard has focus.
    expect(['INPUT', 'TEXTAREA']).not.toContain(document.activeElement?.tagName);
  });

  it('shows the preset icon, description, statuses, categories and visibility above the name field', async () => {
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Drinks' }));
    const details = screen.getByTestId('preset-details');
    const input = screen.getByLabelText('List name');
    // Details come before the name field in the document, so they sit higher in the sheet.
    expect(details.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(details).getByRole('list', { name: 'Statuses' }).textContent).toContain('Want to Try');
    expect(within(details).getByRole('list', { name: 'Categories' }).textContent).toContain('Cocktails');
    expect(within(details).getByText(/Change it any time from the list/)).toBeTruthy();
    expect(screen.getByText('Beer, wine, more')).toBeTruthy();
  });

  it('creates with the suggested name without ever touching the field', async () => {
    vi.mocked(createListFromPreset).mockResolvedValue({ status: 'created', id: 'new', categoriesMissing: false, fields: 'saved' } as never);
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(createListFromPreset).toHaveBeenCalledWith('owner', expect.objectContaining({ key: 'movies' }), 'Movies 2', expect.any(Object));
  });

  it('lifts the sheet above the keyboard when the person opens it, so Create stays reachable', async () => {
    const listeners: Record<string, () => void> = {};
    const vv = { height: window.innerHeight, offsetTop: 0,
      addEventListener: (t: string, f: () => void) => { listeners[t] = f; }, removeEventListener: vi.fn() };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    try {
      renderSheet();
      await userEvent.click(screen.getByRole('button', { name: 'Movies' }));
      const sheet = screen.getByRole('dialog');
      expect(sheet.style.bottom).toBe('');
      // The iPhone keyboard covers the bottom 336pt; the web view itself doesn't resize.
      vv.height = window.innerHeight - 336;
      act(() => listeners.resize());
      expect(sheet.style.bottom).toBe('336px');
      expect(sheet.style.maxHeight).toBe('calc(100dvh - 336px)');
      vv.height = window.innerHeight;
      act(() => listeners.resize());
      expect(sheet.style.bottom).toBe('');
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    }
  });

  it('a real failure to save the preset\'s item fields is reported with a working Try again', async () => {
    vi.mocked(createListFromPreset).mockResolvedValue({ status: 'created', id: 'new', categoriesMissing: false, fields: 'failed' } as never);
    vi.mocked(savePresetFields).mockResolvedValue('saved');
    vi.mocked(toast.warning).mockClear();
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Coffee Beans' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(toast.success).not.toHaveBeenCalledWith('Coffee Beans created');
    const [message, opts] = vi.mocked(toast.warning).mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe('Coffee Beans created, but its item details (like Roaster) didn’t save.');
    expect(opts.action.label).toBe('Try again');
    await act(async () => { opts.action.onClick(); });
    expect(savePresetFields).toHaveBeenCalledWith('owner', 'new', expect.objectContaining({ key: 'coffee_beans' }), ['Light roast', 'Medium roast', 'Dark roast']);
    expect(toast.success).toHaveBeenCalledWith('Coffee Beans details added to Coffee Beans');
  });

  it('where item details aren\'t available (production today) creating a list says nothing extra', async () => {
    vi.mocked(createListFromPreset).mockResolvedValue({ status: 'created', id: 'new', categoriesMissing: false, fields: 'unavailable' } as never);
    vi.mocked(toast.warning).mockClear();
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Coffee Beans' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Coffee Beans created');
  });
});
