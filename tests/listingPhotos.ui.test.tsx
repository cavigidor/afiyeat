import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createFakeSupabase, type FakeSupabase } from './fakeSupabase';

const fake = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  get supabase() {
    return fake.current.client;
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: fake.current.state.viewer } }) }));
vi.mock('sonner', () => ({ toast }));
// jsdom has no canvas; compression is covered elsewhere and irrelevant here.
vi.mock('@/lib/imageValidation', async (orig) => ({
  ...(await orig<typeof import('@/lib/imageValidation')>()),
  compressImage: async (file: File) => file,
}));
vi.mock('@/components/sharing/ShareButton', () => ({ ShareButton: () => null }));
vi.mock('@/components/shared/GetDirectionsButton', () => ({ GetDirectionsButton: () => null }));

import { clearSignedUrlCache, toStoredImageUrl } from '@/lib/storage';
import { RestaurantDetailDialog, type DetailRestaurant } from '@/components/restaurants/RestaurantDetailDialog';
import { ImageUploadSection } from '@/components/restaurants/ImageUploadSection';

const OWNER = 'user-1';
const jpeg = (name = 'p.jpg') => new File(['jpeg'], name, { type: 'image/jpeg' });

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/** jsdom never loads images: fire load/error by hand on the current <img>. */
function loadImg(img: HTMLElement) {
  fireEvent.load(img);
}

function place(images: string[]): DetailRestaurant {
  return {
    id: 'r1',
    name: 'Bistro Monadnock',
    status: 'went_to',
    images: images.map((image_url) => ({ image_url })),
  };
}

beforeEach(() => {
  fake.current = createFakeSupabase();
  clearSignedUrlCache();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe('listing carousel', () => {
  it('shows a spinner until the photo has loaded, then the photo (no broken icon)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/a.jpg`);
    wrap(<RestaurantDetailDialog restaurant={place([toStoredImageUrl('restaurant-images', `${OWNER}/r1/a.jpg`)])} onOpenChange={() => {}} />);

    const img = await screen.findByRole('img', { name: 'Bistro Monadnock' });
    expect(img.getAttribute('src')).toMatch(/\/object\/sign\/restaurant-images\/user-1\/r1\/a\.jpg/);
    expect(screen.getByTestId('photo-loading')).toBeTruthy();
    loadImg(img);
    await waitFor(() => expect(screen.queryByTestId('photo-loading')).toBeNull());
  });

  it('a photo added from Edit (bare storage path) displays on reopen - the Bistro Monadnock case (#2, #6)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/1730000000-abc.jpg`);
    wrap(<RestaurantDetailDialog restaurant={place([`${OWNER}/r1/1730000000-abc.jpg`])} onOpenChange={() => {}} />);
    const img = await screen.findByRole('img', { name: 'Bistro Monadnock' });
    // Before the fix this src was the relative path itself.
    expect(img.getAttribute('src')).toMatch(/^https:\/\/cdn\.test\/storage\/v1\/object\/sign\//);
  });

  it('pages through every photo in a multi-image carousel (#3)', async () => {
    const urls = ['a', 'b', 'c'].map((n) => {
      fake.current.seed('restaurant-images', `${OWNER}/r1/${n}.jpg`);
      return toStoredImageUrl('restaurant-images', `${OWNER}/r1/${n}.jpg`);
    });
    wrap(<RestaurantDetailDialog restaurant={place(urls)} onOpenChange={() => {}} />);

    for (const n of ['a', 'b', 'c', 'a']) {
      const img = await screen.findByRole('img', { name: 'Bistro Monadnock' });
      await waitFor(() => expect(img.getAttribute('src')).toContain(`/r1/${n}.jpg`));
      fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    }
  });

  it('a missing photo keeps its slot with a clean fallback and Retry; the others still load (#6, #12)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/ok.jpg`);
    const urls = [
      toStoredImageUrl('restaurant-images', `${OWNER}/r1/gone.jpg`),
      toStoredImageUrl('restaurant-images', `${OWNER}/r1/ok.jpg`),
    ];
    wrap(<RestaurantDetailDialog restaurant={place(urls)} onOpenChange={() => {}} />);

    const fallback = await screen.findByTestId('photo-fallback');
    expect(within(fallback).getByText('Photo unavailable')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Bistro Monadnock' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    const img = await screen.findByRole('img', { name: 'Bistro Monadnock' });
    expect(img.getAttribute('src')).toContain('/r1/ok.jpg');
  });

  it('Retry recovers a photo once it becomes available', async () => {
    const path = `${OWNER}/r1/late.jpg`;
    wrap(<RestaurantDetailDialog restaurant={place([toStoredImageUrl('restaurant-images', path)])} onOpenChange={() => {}} />);
    await screen.findByTestId('photo-fallback');

    fake.current.seed('restaurant-images', path);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading photo' }));
    const img = await screen.findByRole('img', { name: 'Bistro Monadnock' });
    expect(img.getAttribute('src')).toContain('/r1/late.jpg');
  });

  it('an expired signature is re-signed once automatically, then falls back if it still fails (#7)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/a.jpg`);
    wrap(<RestaurantDetailDialog restaurant={place([`${OWNER}/r1/a.jpg`])} onOpenChange={() => {}} />);

    const first = await screen.findByRole('img', { name: 'Bistro Monadnock' });
    const firstSrc = first.getAttribute('src');
    fireEvent.error(first); // e.g. token expired while the sheet was open
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Bistro Monadnock' }).getAttribute('src')).not.toBe(firstSrc),
    );
    fireEvent.error(screen.getByRole('img', { name: 'Bistro Monadnock' }));
    expect(await screen.findByTestId('photo-fallback')).toBeTruthy();
  });

  it('an unauthorized viewer sees the fallback, never someone else’s photo (#9)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/a.jpg`);
    fake.current.state.viewer = 'user-9';
    wrap(<RestaurantDetailDialog restaurant={place([`${OWNER}/r1/a.jpg`])} onOpenChange={() => {}} />);
    expect(await screen.findByTestId('photo-fallback')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Bistro Monadnock' })).toBeNull();
  });
});

describe('Edit place photo uploader', () => {
  function seedExisting() {
    const path = `${OWNER}/r1/existing.jpg`;
    fake.current.seed('restaurant-images', path, {
      table: 'restaurant_images',
      id: 'existing-1',
      image_url: toStoredImageUrl('restaurant-images', path),
      restaurant_id: 'r1',
    });
    return [{ id: 'existing-1', image_url: toStoredImageUrl('restaurant-images', path) }];
  }

  it('a new photo appears straight away, with a spinner while it uploads (#1, #10)', async () => {
    const existing = seedExisting();
    const onImagesChange = vi.fn();
    const { container } = wrap(<ImageUploadSection restaurantId="r1" existingImages={existing} onImagesChange={onImagesChange} />);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1));

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realFrom = fake.current.client.storage.from;
    fake.current.client.storage.from = (bucket: string) => {
      const api = realFrom(bucket);
      const upload = api.upload;
      return { ...api, upload: vi.fn(async (...args: Parameters<typeof upload>) => (await gate, upload(...args))) };
    };

    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [jpeg('new.jpg')] } });
    expect(await screen.findByTestId('photo-uploading')).toBeTruthy();
    expect(screen.getByText('Photos (1/5)')).toBeTruthy();

    await act(async () => release());
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    expect(screen.queryByTestId('photo-uploading')).toBeNull();
    expect(screen.getByText('Photos (2/5)')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('1 photo added');
    expect(onImagesChange).toHaveBeenCalled();
    // Existing photo untouched, new one stored in the canonical format.
    expect(fake.current.tables.restaurant_images.map((r) => r.id)).toContain('existing-1');
    expect(fake.current.tables.restaurant_images[1].image_url).toContain('/storage/v1/object/public/restaurant-images/user-1/r1/');
    expect(fake.current.calls.some((c) => c.op === 'remove' || c.op === 'delete')).toBe(false);
  });

  it('the live list survives a remount (reopen / refresh reads the database, not a snapshot) (#2, #11)', async () => {
    const existing = seedExisting();
    const first = wrap(<ImageUploadSection restaurantId="r1" existingImages={existing} onImagesChange={() => {}} />);
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [jpeg()] } });
    await waitFor(() => expect(first.container.querySelectorAll('img')).toHaveLength(2));
    first.unmount();

    // Fresh client = app restart; the stale prop still lists only one photo.
    clearSignedUrlCache();
    const second = wrap(<ImageUploadSection restaurantId="r1" existingImages={existing} onImagesChange={() => {}} />);
    await waitFor(() => expect(second.container.querySelectorAll('img')).toHaveLength(2));
    for (const img of second.container.querySelectorAll('img')) {
      expect(img.getAttribute('src')).toMatch(/\/object\/sign\/restaurant-images\//);
    }
  });

  it('a storage failure shows an accurate message and adds nothing (#4)', async () => {
    const existing = seedExisting();
    const { container } = wrap(<ImageUploadSection restaurantId="r1" existingImages={existing} onImagesChange={() => {}} />);
    fake.current.state.failUpload = 1;
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [jpeg()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't add the photo. The photo is too large."));
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a record failure is reported and leaves no orphan behind (#5)', async () => {
    const existing = seedExisting();
    wrap(<ImageUploadSection restaurantId="r1" existingImages={existing} onImagesChange={() => {}} />);
    fake.current.state.failInsert = 1;
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [jpeg(), jpeg()] } });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("1 photo added, 1 couldn't be uploaded. Please try again."),
    );
    expect(fake.current.objects.size).toBe(2); // existing + the one that was recorded
  });
});
