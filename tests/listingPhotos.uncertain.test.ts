import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from './fakeSupabase';

const fake = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('@/integrations/supabase/client', () => ({
  get supabase() {
    return fake.current.client;
  },
}));

import { photoUploadSummary, photoUploadWarning, uploadCustomListPhotos, uploadRestaurantPhotos } from '@/lib/photoUpload';
import { toStoredImageUrl } from '@/lib/storage';

const OWNER = 'user-1';
const jpeg = () => new File(['jpeg-bytes'], 'p.jpg', { type: 'image/jpeg' });
// Short timeouts so "hang" cases finish quickly; real defaults are 60s/15s/10s.
const fast = { timeouts: { upload: 30, insert: 30, lookup: 30 } };

let f: FakeSupabase;
beforeEach(() => {
  f = fake.current = createFakeSupabase();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const removes = () => f.calls.filter((c) => c.op === 'remove');
const inserts = () => f.calls.filter((c) => c.op === 'insert').map((c) => (c.payload as { id: string }).id);
const rows = () => f.tables.restaurant_images;

describe('the database answered clearly', () => {
  it('saved: one row, read back, nothing removed', async () => {
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0, unconfirmed: 0 });
    expect(r.added![0].id).toBe(rows()[0].id);
    expect(removes()).toHaveLength(0);
  });

  it('rejected (403 + 42501) on the only attempt: the just-uploaded object is removed, nothing else', async () => {
    f.state.insertPlan.push('rejected');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 0, failed: 1, unconfirmed: 0 });
    const uploaded = f.calls.find((c) => c.op === 'upload')!.path;
    expect(removes()).toEqual([{ op: 'remove', bucket: 'restaurant-images', payload: [uploaded] }]);
    expect(f.objects.size).toBe(0);
  });
});

describe('the outcome was unclear: never delete, reconcile by row id', () => {
  it('response lost after the row was written: found by lookup, counted as added, object kept', async () => {
    f.state.insertPlan.push('lost');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    expect(rows()).toHaveLength(1);
    expect(inserts()).toHaveLength(1); // no retry needed
    expect(removes()).toHaveLength(0);
    expect(f.objects.size).toBe(1);
  });

  it('readback failed (PGRST116) after the row was written: found, not duplicated, not removed', async () => {
    f.state.insertPlan.push('noReadback');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    expect(rows()).toHaveLength(1);
    expect(removes()).toHaveLength(0);
  });

  it('connection dropped before the write: lookup finds nothing, one retry with the SAME id saves it', async () => {
    f.state.insertPlan.push('dropped');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    expect(rows()).toHaveLength(1);
    const ids = inserts();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(removes()).toHaveLength(0);
  });

  it('a gateway 502 (no database error code) is unclear, not a rejection', async () => {
    f.state.insertPlan.push('gateway');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    expect(removes()).toHaveLength(0);
  });

  it('timeout while the server is still working: the retry and the late commit produce ONE row', async () => {
    f.state.insertPlan.push('hang');
    f.state.lateCommitMs = 80; // lands after our retry
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()], fast);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    await new Promise((res) => setTimeout(res, 120));
    expect(rows()).toHaveLength(1);
    expect(removes()).toHaveLength(0);
  });

  it('response lost AND lookups failing: the retry hits the primary key, which proves the row exists', async () => {
    f.state.insertPlan.push('lost');
    f.state.lookupPlan.push('error', 'error');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0, unconfirmed: 0 });
    expect(rows()).toHaveLength(1);
    expect(removes()).toHaveLength(0);
  });

  it('cannot be settled (write landed, retry refused, lookups fail): reported unconfirmed, object KEPT', async () => {
    f.state.insertPlan.push('lost', 'rejected');
    f.state.lookupPlan.push('error', 'error');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 0, failed: 1, unconfirmed: 1 });
    expect(removes()).toHaveLength(0);
    // The record that did land still points at an existing object.
    const ref = rows()[0].image_url.split('/restaurant-images/')[1];
    expect(f.objects.has(`restaurant-images/${ref}`)).toBe(true);
  });

  it('everything times out: unconfirmed, nothing removed, finishes (UI not left waiting)', async () => {
    f.state.insertPlan.push('hang', 'hang');
    f.state.lookupPlan.push('hang', 'hang');
    const started = Date.now();
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()], fast);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r).toMatchObject({ uploaded: 0, failed: 1, unconfirmed: 1 });
    expect(removes()).toHaveLength(0);
    expect(f.objects.size).toBe(1);
  });

  it('a retry that is refused after a clean "not there" lookup is still not trusted: kept, unconfirmed', async () => {
    f.state.insertPlan.push('dropped', 'rejected');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ failed: 1, unconfirmed: 1 });
    expect(removes()).toHaveLength(0);
  });

  it('works the same for custom-list photos', async () => {
    f.state.insertPlan.push('lost');
    const r = await uploadCustomListPhotos(OWNER, 'item-1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    expect(f.tables.custom_list_item_images).toHaveLength(1);
    expect(removes()).toHaveLength(0);
  });
});

describe('uploads with unclear outcomes', () => {
  it('upload stored but response lost: retry of the same path says "exists", so it continues', async () => {
    f.state.uploadPlan.push('lost');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    const paths = f.calls.filter((c) => c.op === 'upload').map((c) => c.path);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(paths[1]);
    expect(f.objects.size).toBe(1);
  });

  it('the same, when storage reports "already exists" as HTTP 400 with statusCode 409', async () => {
    f.state.uploadPlan.push('lost');
    f.state.duplicateAs400 = true;
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 1, failed: 0 });
    expect(rows()).toHaveLength(1);
  });

  it('upload dropped once, then succeeds on retry', async () => {
    f.state.uploadPlan.push('dropped');
    expect(await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()])).toMatchObject({ uploaded: 1, failed: 0 });
  });

  it('upload keeps failing: reported with a connection message, no record, nothing removed', async () => {
    f.state.uploadPlan.push('dropped', 'dropped');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()]);
    expect(r).toMatchObject({ uploaded: 0, failed: 1, unconfirmed: 0 });
    expect(rows()).toHaveLength(0);
    expect(removes()).toHaveLength(0);
    expect(photoUploadSummary(r).message).toBe("Couldn't add the photo. Check your connection and try again.");
  });

  it('upload hangs: times out, retried once, then reported - the helper always returns', async () => {
    f.state.uploadPlan.push('hang', 'hang');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg()], fast);
    expect(r).toMatchObject({ uploaded: 0, failed: 1 });
    expect(photoUploadSummary(r).message).toBe("Couldn't add the photo. Check your connection and try again.");
  });

  it('one bad photo does not stop the others', async () => {
    f.state.uploadPlan.push('rejected');
    f.state.insertPlan.push(/* first insert belongs to photo 2 */ 'lost');
    const r = await uploadRestaurantPhotos(OWNER, 'r1', [jpeg(), jpeg(), jpeg()]);
    expect(r).toMatchObject({ uploaded: 2, failed: 1 });
    expect(rows()).toHaveLength(2);
  });
});

describe('messages', () => {
  it('unconfirmed photos get their own, non-alarming wording', () => {
    expect(photoUploadSummary({ uploaded: 0, failed: 1, unconfirmed: 1 }).message).toBe(
      "Couldn't confirm the photo was saved - refresh in a moment to check.",
    );
    expect(photoUploadSummary({ uploaded: 2, failed: 1, unconfirmed: 1 }).message).toBe(
      "2 photos added, 1 couldn't be confirmed yet - refresh in a moment to check.",
    );
    expect(photoUploadWarning({ uploaded: 0, failed: 1, unconfirmed: 1 })).toBe(
      "Your item was saved, but we couldn't confirm 1 photo. Refresh in a moment - it may already be there.",
    );
    expect(photoUploadWarning({ uploaded: 0, failed: 3, unconfirmed: 1 })).toBe(
      "Your item was saved, but 2 photos couldn't be attached. Open the item to add them again. 1 photo couldn't be confirmed yet - refresh to check.",
    );
  });
});

describe('old records are untouched', () => {
  it('existing bare-path and URL rows and their objects survive any failure path', async () => {
    f.seed('restaurant-images', `${OWNER}/r1/old-bare.jpg`, { table: 'restaurant_images', image_url: `${OWNER}/r1/old-bare.jpg`, restaurant_id: 'r1' });
    f.seed('restaurant-images', `${OWNER}/r1/old-url.jpg`, {
      table: 'restaurant_images',
      image_url: toStoredImageUrl('restaurant-images', `${OWNER}/r1/old-url.jpg`),
      restaurant_id: 'r1',
    });
    f.state.insertPlan.push('rejected', 'lost', 'hang', 'hang');
    f.state.lookupPlan.push('error', 'hang', 'hang');
    await uploadRestaurantPhotos(OWNER, 'r1', [jpeg(), jpeg(), jpeg()], fast);
    expect(f.objects.has(`restaurant-images/${OWNER}/r1/old-bare.jpg`)).toBe(true);
    expect(f.objects.has(`restaurant-images/${OWNER}/r1/old-url.jpg`)).toBe(true);
    expect(rows().filter((r) => r.image_url.includes('old-'))).toHaveLength(2);
    for (const c of removes()) expect((c.payload as string[]).some((p) => p.includes('old-'))).toBe(false);
  });
});
