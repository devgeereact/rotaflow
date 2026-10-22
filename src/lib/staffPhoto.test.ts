import { describe, expect, it } from 'vitest';
import {
  MAX_PHOTO_BYTES,
  photoFileProblem,
  photoObjectPath,
  photoSource,
  storedPhotoPath,
} from './staffPhoto';

const ORG = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

describe('photoFileProblem', () => {
  it('accepts a small picture', () => {
    expect(
      photoFileProblem({ name: 'me.jpg', size: 1000, type: 'image/jpeg' }),
    ).toBeNull();
  });

  it('refuses an empty file, a large one and a document', () => {
    expect(photoFileProblem({ name: 'me.jpg', size: 0, type: 'image/jpeg' })).toMatch(
      /empty/,
    );
    expect(
      photoFileProblem({ name: 'me.jpg', size: MAX_PHOTO_BYTES + 1, type: 'image/jpeg' }),
    ).toMatch(/2 MB/);
    expect(
      photoFileProblem({ name: 'cv.pdf', size: 1000, type: 'application/pdf' }),
    ).toMatch(/JPEG, PNG or WebP/);
  });
});

describe('photoObjectPath', () => {
  it('puts the photo in the person folder with a safe name', () => {
    expect(photoObjectPath(ORG, PERSON, 'u1', 'My Photo!.JPG')).toBe(
      `${ORG}/${PERSON}/u1-My-Photo.jpg`,
    );
  });
});

describe('photoSource and storedPhotoPath', () => {
  it('prefers a stored photo, then a legacy link, then nothing', () => {
    const path = `${ORG}/${PERSON}/u1-me.jpg`;
    const stored = photoSource({ photo_url: null, photo_path: path });
    expect(storedPhotoPath(stored)).toBe(path);
    expect(photoSource({ photo_url: 'https://example.test/me.jpg' })).toBe(
      'https://example.test/me.jpg',
    );
    expect(photoSource({ photo_url: null, photo_path: null })).toBeNull();
    expect(photoSource(null)).toBeNull();
  });

  it('reads a link or nothing as not stored', () => {
    expect(storedPhotoPath('https://example.test/me.jpg')).toBeNull();
    expect(storedPhotoPath(null)).toBeNull();
    expect(storedPhotoPath('stored-photo:')).toBeNull();
  });
});
