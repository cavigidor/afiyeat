import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { photoLimitError } from '@/lib/imageValidation';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const native = vi.hoisted(() => ({
  isNative: vi.fn(() => false),
  pickGalleryPhotos: vi.fn(),
  capturePhoto: vi.fn(),
}));
const compressed = vi.hoisted(() => ({ calls: [] as string[][] }));

vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/native', () => native);
vi.mock('@/lib/imageValidation', async (orig) => ({
  ...(await orig<typeof import('@/lib/imageValidation')>()),
  compressImages: async (files: File[]) => {
    compressed.calls.push(files.map((f) => f.name));
    return files;
  },
}));

const jpeg = (name = 'p.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const jpegs = (n: number) => Array.from({ length: n }, (_, i) => jpeg(`p${i}.jpg`));

function setup(count: number) {
  const onReady = vi.fn();
  const hook = renderHook(() => usePhotoPicker({ max: 5, count, onReady }));
  return { onReady, hook };
}

beforeEach(() => {
  toast.error.mockReset();
  native.isNative.mockReturnValue(false);
  native.pickGalleryPhotos.mockReset();
  compressed.calls = [];
});

describe('photoLimitError', () => {
  it.each([
    [5, 0, null],
    [6, 0, 'You can only add 5 images.'],
    [12, 0, 'You can only add 5 images.'],
    [3, 2, null],
    [4, 2, 'You can only add 5 images. You have room for 3 more.'],
    [1, 5, 'You can only add 5 images. Remove one to add another.'],
  ])('%i picked with %i already added', (picked, have, expected) => {
    expect(photoLimitError(picked, have, 5)).toBe(expected);
  });
});

describe('usePhotoPicker', () => {
  it('rejects a selection over the cap at once, without compressing or keeping any of it', async () => {
    const { onReady, hook } = setup(0);
    await act(() => hook.result.current.addFiles(jpegs(8)));
    expect(toast.error).toHaveBeenCalledWith('You can only add 5 images.');
    expect(compressed.calls).toEqual([]);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('counts photos already added', async () => {
    const { onReady, hook } = setup(3);
    await act(() => hook.result.current.addFiles(jpegs(3)));
    expect(toast.error).toHaveBeenCalledWith('You can only add 5 images. You have room for 2 more.');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('accepts up to the cap and hands over compressed photos', async () => {
    const { onReady, hook } = setup(0);
    await act(() => hook.result.current.addFiles(jpegs(5)));
    expect(toast.error).not.toHaveBeenCalled();
    expect(compressed.calls).toHaveLength(1);
    expect(onReady).toHaveBeenCalledWith(expect.arrayContaining([expect.any(File)]));
    expect(onReady.mock.calls[0][0]).toHaveLength(5);
  });

  it('on iPhone, opens the native picker capped at the remaining slots', async () => {
    native.isNative.mockReturnValue(true);
    native.pickGalleryPhotos.mockResolvedValue({ status: 'picked', files: jpegs(2) });
    const { onReady, hook } = setup(3);
    await act(() => hook.result.current.openPicker());
    expect(native.pickGalleryPhotos).toHaveBeenCalledWith(2);
    expect(onReady.mock.calls[0][0]).toHaveLength(2);
  });

  it('on iPhone with four photos, the picker allows exactly one more', async () => {
    native.isNative.mockReturnValue(true);
    native.pickGalleryPhotos.mockResolvedValue({ status: 'picked', files: jpegs(1) });
    const { onReady, hook } = setup(4);
    await act(() => hook.result.current.openPicker());
    expect(native.pickGalleryPhotos).toHaveBeenCalledWith(1);
    expect(onReady.mock.calls[0][0]).toHaveLength(1);
  });

  it('exactly five on an empty item is accepted; a sixth on top is refused', async () => {
    const empty = setup(0);
    await act(() => empty.hook.result.current.addFiles(jpegs(5)));
    expect(empty.onReady.mock.calls[0][0]).toHaveLength(5);
    const full = setup(5);
    await act(() => full.hook.result.current.addFiles(jpegs(1)));
    expect(toast.error).toHaveBeenCalledWith('You can only add 5 images. Remove one to add another.');
    expect(full.onReady).not.toHaveBeenCalled();
  });

  it('on iPhone with no slots left, explains instead of opening the picker', async () => {
    native.isNative.mockReturnValue(true);
    const { hook } = setup(5);
    await act(() => hook.result.current.openPicker());
    expect(native.pickGalleryPhotos).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('You can only add 5 images. Remove one to add another.');
  });

  it('falls back to the file input if the native picker is unavailable', async () => {
    native.isNative.mockReturnValue(true);
    native.pickGalleryPhotos.mockResolvedValue({ status: 'unavailable' });
    const { hook } = setup(0);
    const click = vi.fn();
    hook.result.current.inputRef.current = { click } as unknown as HTMLInputElement;
    await act(() => hook.result.current.openPicker());
    expect(click).toHaveBeenCalled();
  });

  it('does nothing when the native picker is cancelled', async () => {
    native.isNative.mockReturnValue(true);
    native.pickGalleryPhotos.mockResolvedValue({ status: 'cancelled' });
    const { onReady, hook } = setup(0);
    const click = vi.fn();
    hook.result.current.inputRef.current = { click } as unknown as HTMLInputElement;
    await act(() => hook.result.current.openPicker());
    expect(click).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
