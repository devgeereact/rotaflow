import { describe, expect, it } from 'vitest';
import { parsePurgeRequest, splitListing } from './request';

const ORG = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

describe('parsePurgeRequest', () => {
  it('accepts an object path in its person folder', () => {
    expect(
      parsePurgeRequest({
        bucket: 'staff-documents',
        path: `${ORG}/${PERSON}/abc-passport.pdf`,
        isFolder: false,
      }),
    ).toEqual({
      bucket: 'staff-documents',
      path: `${ORG}/${PERSON}/abc-passport.pdf`,
      isFolder: false,
    });
  });

  it('accepts an organisation folder and a person folder', () => {
    expect(
      parsePurgeRequest({ bucket: 'staff-documents', path: ORG, isFolder: true }),
    ).not.toBeNull();
    expect(
      parsePurgeRequest({
        bucket: 'staff-documents',
        path: `${ORG}/${PERSON}`,
        isFolder: true,
      }),
    ).not.toBeNull();
  });

  it('accepts the staff-photos bucket in the same shapes (0162)', () => {
    expect(
      parsePurgeRequest({
        bucket: 'staff-photos',
        path: `${ORG}/${PERSON}/me.jpg`,
        isFolder: false,
      }),
    ).toEqual({
      bucket: 'staff-photos',
      path: `${ORG}/${PERSON}/me.jpg`,
      isFolder: false,
    });
    expect(
      parsePurgeRequest({
        bucket: 'staff-photos',
        path: `${ORG}/${PERSON}`,
        isFolder: true,
      }),
    ).not.toBeNull();
  });

  it('refuses another bucket', () => {
    expect(
      parsePurgeRequest({ bucket: 'avatars', path: ORG, isFolder: true }),
    ).toBeNull();
  });

  it('refuses an empty folder, which would mean the whole bucket', () => {
    expect(
      parsePurgeRequest({ bucket: 'staff-documents', path: '', isFolder: true }),
    ).toBeNull();
  });

  it('refuses traversal, a leading slash and a nested file', () => {
    for (const path of [
      `${ORG}/../x`,
      `/${ORG}`,
      `${ORG}/${PERSON}/a/b.pdf`,
      `${ORG}/${PERSON}/`,
      'not-a-uuid/x/y.pdf',
    ]) {
      expect(
        parsePurgeRequest({ bucket: 'staff-documents', path, isFolder: false }),
      ).toBeNull();
      expect(
        parsePurgeRequest({ bucket: 'staff-documents', path, isFolder: true }),
      ).toBeNull();
    }
  });

  it('refuses a file path flagged as a folder and the reverse', () => {
    expect(
      parsePurgeRequest({
        bucket: 'staff-documents',
        path: `${ORG}/${PERSON}/a.pdf`,
        isFolder: true,
      }),
    ).toBeNull();
    expect(
      parsePurgeRequest({ bucket: 'staff-documents', path: ORG, isFolder: false }),
    ).toBeNull();
  });

  it('refuses a malformed body', () => {
    expect(parsePurgeRequest(null)).toBeNull();
    expect(parsePurgeRequest('x')).toBeNull();
    expect(parsePurgeRequest({ bucket: 'staff-documents', path: ORG })).toBeNull();
  });
});

describe('splitListing', () => {
  it('separates objects from sub-folders by the missing id', () => {
    expect(
      splitListing(ORG, [
        { name: PERSON, id: null },
        { name: 'stray.pdf', id: 'obj-1' },
      ]),
    ).toEqual({ objects: [`${ORG}/stray.pdf`], folders: [`${ORG}/${PERSON}`] });
  });
});
