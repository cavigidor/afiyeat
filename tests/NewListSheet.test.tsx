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
// Item details exist on the backend (as in production since 94e8099) unless a test says otherwise.
let detailsOn = true;
vi.mock('@/lib/itemDetails', () => ({ detailsAvailable: vi.fn(async () => detailsOn) }));

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
  beforeEach(() => {
    detailsOn = true;
    vi.mocked(createListFromPreset).mockReset();
    vi.mocked(savePresetFields).mockReset();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.success).mockClear();
  });

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
    expect(within(details).getByRole('group', { name: 'Statuses' }).textContent).toContain('Want to Try');
    expect(within(details).getByRole('group', { name: 'Categories' }).textContent).toContain('Cocktails');
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
    vi.mocked(createListFromPreset).mockResolvedValue({ status: 'created', id: 'new', categoriesMissing: false, fields: 'failed', categoryNames: ['Light roast', 'Medium roast', 'Dark roast'] } as never);
    vi.mocked(savePresetFields).mockResolvedValue('saved');
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Coffee Beans' }));
    await screen.findByRole('group', { name: 'Details' });
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(toast.success).not.toHaveBeenCalledWith('Coffee Beans created');
    const [message, opts] = vi.mocked(toast.warning).mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe('Coffee Beans created, but its item details (like Roaster) didn’t save.');
    expect(opts.action.label).toBe('Try again');
    await act(async () => { opts.action.onClick(); });
    expect(savePresetFields).toHaveBeenCalledWith('owner', 'new', expect.objectContaining({ key: 'coffee_beans' }), ['Light roast', 'Medium roast', 'Dark roast'],
      ['c_roaster', 'c_roast', 'c_taste_profile', 'c_best_for', 'c_origin', 'c_process', 'c_roast_date']);
    expect(toast.success).toHaveBeenCalledWith('Coffee Beans details added to Coffee Beans');
  });

  it('where item details aren\'t available (production today) creating a list says nothing extra', async () => {
    detailsOn = false;
    vi.mocked(createListFromPreset).mockResolvedValue({ status: 'created', id: 'new', categoriesMissing: false, fields: 'unavailable' } as never);
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Coffee Beans' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Coffee Beans created');
  });

});

describe('NewListSheet: preset options are toggles', () => {
  beforeEach(() => {
    detailsOn = true;
    vi.mocked(createListFromPreset).mockReset();
    vi.mocked(createListFromPreset).mockResolvedValue({ status: 'created', id: 'new', categoriesMissing: false, fields: 'saved', categoryNames: [] } as never);
    vi.mocked(savePresetFields).mockReset();
    vi.mocked(toast.warning).mockClear();
  });
  const chips = (row: string) => within(screen.getByRole('group', { name: row })).getAllByRole('button');
  const chip = (row: string, name: string) => within(screen.getByRole('group', { name: row })).getByRole('button', { name: new RegExp(`^(\\S+ )?${name}$`) });
  const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed') === 'true';
  async function open(presetName: string, more = false) {
    renderSheet();
    if (more) await userEvent.click(screen.getByRole('button', { name: 'More presets' }));
    await userEvent.click(screen.getByRole('button', { name: presetName }));
    await screen.findByRole('group', { name: 'Statuses' });
  }
  const sentSelection = () => (vi.mocked(createListFromPreset).mock.calls[0][3] as { selection: Record<string, unknown> }).selection;

  it('every chip is a button with aria-pressed; a tap toggles it and a second tap restores it, with the primary colour only when selected', async () => {
    await open('Restaurants');
    const s = chip('Statuses', 'Want to Go');
    expect(s.tagName).toBe('BUTTON');
    expect(pressed(s)).toBe(true);
    expect(s.className).toContain('bg-primary');
    await userEvent.click(s);
    expect(pressed(s)).toBe(false);
    expect(s.className).toContain('bg-background');
    expect(s.className).not.toContain('bg-primary');
    await userEvent.click(s);
    expect(pressed(s)).toBe(true);
    expect(['INPUT', 'TEXTAREA']).not.toContain(document.activeElement?.tagName); // still no keyboard
  });

  const ALL = [
    ...['Restaurants', 'Drinks', 'Coffee Beans', 'Movies', 'Stores', 'Travel'].map((n) => [n, false] as const),
    ...['Coffee Shops', 'Shows', 'Books', 'Concerts', 'Wines', 'Beers'].map((n) => [n, true] as const),
  ];
  it.each(ALL)('%s: the preset\'s defaults start selected, the same in every row', async (presetName, more) => {
    const { V2_PRESETS, MORE_PRESETS } = await import('@/lib/listPresets');
    const preset = [...V2_PRESETS, ...MORE_PRESETS].find((p) => p.label === presetName)!;
    await open(presetName, more);
    expect(chips('Statuses').map((b) => [b.textContent, pressed(b)])).toEqual(preset.statuses.map((x: string) => [x, true]));
    const cats = screen.queryByRole('group', { name: 'Categories' });
    if (preset.categories.length && !preset.fieldsReplaceCategories) expect(within(cats!).getAllByRole('button').every(pressed)).toBe(true);
    else expect(cats).toBeNull();
    const { fieldsForPreset } = await import('@/lib/presetFields');
    expect(chips('Details').length).toBe(fieldsForPreset(preset.key).length);
    expect(chips('Details').every(pressed)).toBe(true);
    const on = { Location: preset.config.show_location, Price: preset.config.show_price, Photos: preset.config.show_photos, Notes: preset.config.show_notes };
    for (const [label, want] of Object.entries(on)) expect(pressed(chip('Tracks', label)), `${presetName} ${label}`).toBe(want);
  });

  it('unchanged, creation sends exactly the preset defaults', async () => {
    await open('Drinks');
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    const { V2_PRESETS } = await import('@/lib/listPresets');
    const { fieldsForPreset } = await import('@/lib/presetFields');
    const drinks = V2_PRESETS.find((p) => p.key === 'drinks')!;
    expect(sentSelection()).toEqual({
      statuses: drinks.statuses, categories: drinks.categories.map((c) => c.name), categoriesIfNoFields: undefined,
      fieldKeys: fieldsForPreset('drinks').map((f) => f.key),
      tracks: { show_location: drinks.config.show_location, show_price: drinks.config.show_price, show_rating: drinks.config.show_rating, show_photos: drinks.config.show_photos, show_notes: drinks.config.show_notes },
    });
  });

  it('only what stays selected is created: statuses, categories, details and tracking', async () => {
    await open('Drinks');
    await userEvent.click(chip('Statuses', 'Want to Try'));
    await userEvent.click(chip('Categories', 'Spirits'));
    await userEvent.click(chip('Details', 'Vintage'));
    await userEvent.click(chip('Details', 'Beer style'));
    await userEvent.click(chip('Tracks', 'Photos'));
    await userEvent.click(chip('Tracks', 'Location'));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    const sel = sentSelection() as { statuses: string[]; categories: string[]; fieldKeys: string[]; tracks: Record<string, boolean> };
    expect(sel.statuses).toEqual(['Tried']);
    expect(sel.categories).not.toContain('Spirits');
    expect(sel.categories).toContain('Beer');
    expect(sel.fieldKeys).not.toContain('c_vintage');
    expect(sel.fieldKeys).not.toContain('c_beer_style');
    expect(sel.fieldKeys).toContain('c_brewery');
    expect(sel.tracks).toMatchObject({ show_photos: false, show_location: true });
  });

  it('with every status deselected it explains why and won\'t create', async () => {
    await open('Movies');
    for (const b of chips('Statuses')) await userEvent.click(b);
    expect(screen.getByRole('alert').textContent).toBe('Keep at least one status: every item needs one.');
    expect((screen.getByRole('button', { name: 'Create list' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(chip('Statuses', 'Watched'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Create list' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Coffee Beans: no roast categories offered; deselecting Roast means no roast categories, even as a fallback', async () => {
    await open('Coffee Beans');
    expect(screen.queryByRole('group', { name: 'Categories' })).toBeNull();
    await userEvent.click(chip('Details', 'Roast'));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(sentSelection()).toMatchObject({ categories: [], categoriesIfNoFields: [] });
    expect((sentSelection() as { fieldKeys: string[] }).fieldKeys).not.toContain('c_roast');
  });

  it('Coffee Beans with Roast kept: roast categories only as the fallback if the fields can\'t be saved', async () => {
    await open('Coffee Beans');
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(sentSelection()).toMatchObject({ categories: [], categoriesIfNoFields: ['Light roast', 'Medium roast', 'Dark roast'] });
  });

  it('a failed field save: Try again sends only the selected fields, never the deselected ones', async () => {
    vi.mocked(createListFromPreset).mockResolvedValue({ status: 'created', id: 'new', categoriesMissing: false, fields: 'failed', categoryNames: [] } as never);
    vi.mocked(savePresetFields).mockResolvedValue('saved');
    await open('Coffee Beans');
    await userEvent.click(chip('Details', 'Roast'));
    await userEvent.click(chip('Details', 'Best for'));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    const [, opts] = vi.mocked(toast.warning).mock.calls[0] as unknown as [string, { action: { onClick: () => void } }];
    await act(async () => { opts.action.onClick(); });
    const keys = vi.mocked(savePresetFields).mock.calls[0][4]!;
    expect(keys).toEqual(['c_roaster', 'c_taste_profile', 'c_origin', 'c_process', 'c_roast_date']);
    expect(vi.mocked(savePresetFields).mock.calls[0][3]).toEqual([]); // no roast categories were made
  });

  it('without item details on the backend: no Details row, and Coffee Beans offers its roast categories as before', async () => {
    detailsOn = false;
    await open('Coffee Beans');
    expect(screen.queryByRole('group', { name: 'Details' })).toBeNull();
    expect(chips('Categories').map((b) => b.textContent)).toEqual(['Light roast', 'Medium roast', 'Dark roast']);
    await userEvent.click(chip('Categories', 'Dark roast'));
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(sentSelection()).toMatchObject({ categories: ['Light roast', 'Medium roast'], categoriesIfNoFields: undefined, fieldKeys: [] });
  });
});

