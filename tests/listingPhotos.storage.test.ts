import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from './fakeSupabase';

const fake = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('@/integrations/supabase/client', () => ({
  get supabase() {
    return fake.current.client;
  },
}));

import {
  clearSignedUrlCache,
  forgetSignedUrl,
  getSignedUrl,
  parseStorageRef,
  peekSignedUrl,
  resolveImageUrl,
  toStoredImageUrl,
} from '@/lib/storage';
import { photoExtension, photoUploadSummary, photoUploadWarning, uploadCustomListPhotos, uploadRestaurantPhotos } from '@/lib/photoUpload';

const BASE = import.meta.env.VITE_SUPABASE_URL;
const OWNER = 'user-1';
const STRANGER = 'user-9';
const jpeg = (name = 'photo.jpg') => new File(['jpeg-bytes'], name, { type: 'image/jpeg' });

beforeEach(() => {
  fake.current = createFakeSupabase();
  clearSignedUrlCache();
});

describe('parseStorageRef: every shape ever stored in image_url', () => {
  it('reads a public-URL-shaped link (Add place, custom lists, recipes)', () => {
    expect(parseStorageRef(`${BASE}/storage/v1/object/public/restaurant-images/u/r/a.jpg`)).toEqual({
      bucket: 'restaurant-images',
      path: 'u/r/a.jpg',
    });
    expect(parseStorageRef(`${BASE}/storage/v1/object/public/custom-list-images/u/i/b.jpg`)).toEqual({
      bucket: 'custom-list-images',
      path: 'u/i/b.jpg',
    });
  });

  it('reads a bare object path (Edit place uploader) - the regression', () => {
    expect(parseStorageRef('u/r/1730000000-abc.jpg')).toEqual({ bucket: 'restaurant-images', path: 'u/r/1730000000-abc.jpg' });
    expect(parseStorageRef('u/i/x.jpg', 'custom-list-images')).toEqual({ bucket: 'custom-list-images', path: 'u/i/x.jpg' });
    expect(parseStorageRef('custom-list-images/u/i/x.jpg')).toEqual({ bucket: 'custom-list-images', path: 'u/i/x.jpg' });
  });

  it('reads signed and authenticated URLs back to their object, dropping the token', () => {
    expect(parseStorageRef(`${BASE}/storage/v1/object/sign/restaurant-images/u/r/a.jpg?token=old`)).toEqual({
      bucket: 'restaurant-images',
      path: 'u/r/a.jpg',
    });
    expect(parseStorageRef(`${BASE}/storage/v1/object/authenticated/restaurant-images/u/r/a%20b.jpg`)).toEqual({
      bucket: 'restaurant-images',
      path: 'u/r/a b.jpg',
    });
  });

  it('leaves external, data:, blob:, root-relative and unknown-bucket URLs alone', () => {
    for (const value of [
      'https://images.example.com/x.jpg',
      'data:image/png;base64,AAAA',
      'blob:https://afiyeat.com/123',
      '/placeholder.svg',
      `${BASE}/storage/v1/object/public/avatars/a.png`,
      '',
      null,
      undefined,
    ]) {
      expect(parseStorageRef(value)).toBeNull();
    }
  });
});

describe('signing for display', () => {
  it('signs a bare-path record instead of handing the browser a relative URL (#6 invalid URL)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/old.jpg`);
    const url = await getSignedUrl(`${OWNER}/r1/old.jpg`);
    expect(url).toMatch(/^https:\/\/cdn\.test\/storage\/v1\/object\/sign\/restaurant-images\/user-1\/r1\/old\.jpg\?token=/);
  });

  it('signs a public-shaped record and caches the signature', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/a.jpg`);
    const stored = toStoredImageUrl('restaurant-images', `${OWNER}/r1/a.jpg`);
    const first = await getSignedUrl(stored);
    const second = await getSignedUrl(stored);
    expect(first).toBe(second);
    expect(fake.current.state.signCount).toBe(1);
    expect(peekSignedUrl(stored)).toBe(first);
  });

  it('re-signs an expired signed URL rather than reusing its dead token (#7)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/a.jpg`);
    const stale = `${BASE}/storage/v1/object/sign/restaurant-images/${OWNER}/r1/a.jpg?token=expired`;
    const url = await getSignedUrl(stale);
    expect(url).not.toBe(stale);
    expect(url).toContain('token=t1');
  });

  it('forgetSignedUrl forces a fresh signature (used on <img> error and Retry)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/a.jpg`);
    const first = await getSignedUrl(`${OWNER}/r1/a.jpg`);
    forgetSignedUrl(`${OWNER}/r1/a.jpg`);
    const second = await getSignedUrl(`${OWNER}/r1/a.jpg`);
    expect(second).not.toBe(first);
  });

  it('reports a record whose object is missing, without caching the failure (#6)', async () => {
    const result = await resolveImageUrl(`${OWNER}/r1/gone.jpg`);
    expect(result).toEqual({ url: null, failure: 'missing' });
    fake.current.seed('restaurant-images', `${OWNER}/r1/gone.jpg`);
    expect((await resolveImageUrl(`${OWNER}/r1/gone.jpg`)).url).toBeTruthy();
  });

  it('classifies a 403 as forbidden and anything else as error', async () => {
    fake.current.state.failSign = { status: 403, message: 'Unauthorized' };
    expect((await resolveImageUrl(`${OWNER}/r1/a.jpg`)).failure).toBe('forbidden');
    fake.current.state.failSign = { status: 500, message: 'boom' };
    clearSignedUrlCache();
    expect((await resolveImageUrl(`${OWNER}/r1/a.jpg`)).failure).toBe('error');
  });

  it('passes external images through untouched, without a storage call', async () => {
    expect(await getSignedUrl('https://images.example.com/x.jpg')).toBe('https://images.example.com/x.jpg');
    expect(fake.current.state.signCount).toBe(0);
  });
});

describe('image access stays private (#8, #9)', () => {
  beforeEach(() => fake.current.seed('restaurant-images', `${OWNER}/r1/a.jpg`));

  it('the owner can see their photo', async () => {
    expect(await getSignedUrl(`${OWNER}/r1/a.jpg`)).toBeTruthy();
  });

  it('an accepted follower can see it', async () => {
    fake.current.state.viewer = STRANGER;
    fake.current.state.followers.add(`${STRANGER}->${OWNER}`);
    expect(await getSignedUrl(`${OWNER}/r1/a.jpg`)).toBeTruthy();
  });

  it('anyone else gets no URL - nothing is made public to work around loading', async () => {
    fake.current.state.viewer = STRANGER;
    expect(await resolveImageUrl(`${OWNER}/r1/a.jpg`)).toEqual({ url: null, failure: 'missing' });
    expect(fake.current.calls.some((c) => c.op === 'sign')).toBe(true);
  });
});

describe('uploading photos', () => {
  it('uploads to the owner folder and stores ONE canonical format, returning the rows (#1)', async () => {
    const result = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg(), jpeg('b.png')]);
    expect(result).toMatchObject({ uploaded: 2, failed: 0 });
    expect(result.added).toHaveLength(2);
    for (const row of fake.current.tables.restaurant_images) {
      expect(row.image_url.startsWith(`${BASE}/storage/v1/object/public/restaurant-images/${OWNER}/r1/`)).toBe(true);
      expect(row.restaurant_id).toBe('r1');
      const ref = parseStorageRef(row.image_url)!;
      expect(fake.current.objects.has(`${ref.bucket}/${ref.path}`)).toBe(true);
    }
    // MIME type decides the extension, not the file name.
    expect(fake.current.tables.restaurant_images[1].image_url).toMatch(/\.jpg$/);
  });

  it('custom-list photos go to their own bucket and table', async () => {
    const result = await uploadCustomListPhotos(OWNER, 'item-1', [jpeg()]);
    expect(result.uploaded).toBe(1);
    expect(fake.current.tables.custom_list_item_images[0]).toMatchObject({ item_id: 'item-1', user_id: OWNER });
    expect(fake.current.tables.custom_list_item_images[0].image_url).toContain('/custom-list-images/');
  });

  it('a storage failure is counted, writes no record, and keeps going (#4)', async () => {
    fake.current.state.failUpload = 1;
    const result = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg(), jpeg()]);
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect(fake.current.tables.restaurant_images).toHaveLength(1);
    expect(photoUploadSummary(result)).toEqual({
      kind: 'partial',
      message: "1 photo added, 1 couldn't be uploaded. The photo is too large.",
    });
  });

  it('a record failure removes only the object just uploaded, never existing ones (#5, #12)', async () => {
    fake.current.seed('restaurant-images', `${OWNER}/r1/existing.jpg`, {
      table: 'restaurant_images',
      image_url: toStoredImageUrl('restaurant-images', `${OWNER}/r1/existing.jpg`),
      restaurant_id: 'r1',
    });
    fake.current.state.failInsert = 1;
    const result = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(result).toMatchObject({ uploaded: 0, failed: 1 });
    const upload = fake.current.calls.find((c) => c.op === 'upload')!;
    const removes = fake.current.calls.filter((c) => c.op === 'remove');
    expect(removes).toEqual([{ op: 'remove', bucket: 'restaurant-images', payload: [upload.path] }]);
    expect(fake.current.objects.has(`restaurant-images/${OWNER}/r1/existing.jpg`)).toBe(true);
    expect(fake.current.tables.restaurant_images).toHaveLength(1);
    expect(photoUploadSummary(result).kind).toBe('error');
  });

  it('cannot write into another user’s folder', async () => {
    const result = await uploadRestaurantPhotos(STRANGER, 'r1', [jpeg()]);
    // Viewer is OWNER; the path would be STRANGER's folder -> refused.
    expect(result).toMatchObject({ uploaded: 0, failed: 1 });
    expect(fake.current.tables.restaurant_images).toHaveLength(0);
  });

  it('never throws, so a saved listing is preserved and partial success is reported', async () => {
    fake.current.state.failUpload = 5;
    const result = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg(), jpeg()]);
    expect(result.failed).toBe(2);
    expect(photoUploadWarning(result)).toBe(
      "Your item was saved, but 2 photos couldn't be attached. Open the item to add them again.",
    );
    expect(photoUploadWarning({ uploaded: 2, failed: 0 })).toBeNull();
  });

  it('picks an extension from the MIME type', () => {
    expect(photoExtension(new File([''], 'image', { type: 'image/jpeg' }))).toBe('jpg');
    expect(photoExtension(new File([''], 'a.webp', { type: 'image/webp' }))).toBe('webp');
    expect(photoExtension(new File([''], 'a.HEIC', { type: '' }))).toBe('heic');
  });
});
