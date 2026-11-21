import imageCompression from 'browser-image-compression';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PhotoError, compressPhoto } from '../../src/client/photos/compress';

vi.mock('browser-image-compression', () => ({ default: vi.fn() }));

const compress = vi.mocked(imageCompression);
const input = new File([new Uint8Array([1, 2, 3])], 'IMG_0001.HEIC', { type: 'image/heic' });

afterEach(() => {
  compress.mockReset();
});

describe('compressPhoto', () => {
  // 0.4 MB keeps 15 photos plus signature under the 12 MB body limit. No web worker: the
  // library would load it from a CDN, which the CSP blocks.
  test('compresses to max 1280px and 0.4 MB, JPEG at quality 0.7, on the main thread', async () => {
    compress.mockResolvedValue(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' }));
    const url = await compressPhoto(input);
    expect(url).toBe('data:image/jpeg;base64,/9j/');
    expect(compress).toHaveBeenCalledExactlyOnceWith(input, {
      maxSizeMB: 0.4,
      maxWidthOrHeight: 1280,
      initialQuality: 0.7,
      fileType: 'image/jpeg',
      useWebWorker: false,
    });
  });

  test('a photo that cannot be decoded throws PhotoError with a Dutch message', async () => {
    compress.mockRejectedValue(new Error('Failed to load image'));
    const err = await compressPhoto(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoError);
    expect((err as PhotoError).message).toBe('Deze foto kan niet gebruikt worden. Maak een nieuwe foto.');
  });

  test('a result above the 1.5 MB photo limit is rejected', async () => {
    compress.mockResolvedValue(new File([new Uint8Array(1_500_001)], 'x.jpg', { type: 'image/jpeg' }));
    await expect(compressPhoto(input)).rejects.toBeInstanceOf(PhotoError);
    compress.mockResolvedValue(new File([new Uint8Array(1_500_000)], 'x.jpg', { type: 'image/jpeg' }));
    await expect(compressPhoto(input)).resolves.toMatch(/^data:image\/jpeg;base64,/);
  });

  test('a result that is not a JPEG is rejected as well', async () => {
    compress.mockResolvedValue(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
    await expect(compressPhoto(input)).rejects.toBeInstanceOf(PhotoError);
  });
});
