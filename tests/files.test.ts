import { describe, expect, it } from 'vitest';
import { defaultLinkName, fileCategory, folderPath, linkService, looksLikeUrl, normalizeUrl, uniqueName } from '@/lib/files';
import type { FileNode } from '@/lib/types';

describe('links', () => {
  it('normalises pasted URLs and rejects other schemes', () => {
    expect(normalizeUrl('web.plaud.ai/share/abc')).toBe('https://web.plaud.ai/share/abc');
    expect(normalizeUrl('  https://figma.com/file/1  ')).toBe('https://figma.com/file/1');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('localhost')).toBeNull();
    expect(normalizeUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('detects URLs in pasted text', () => {
    expect(looksLikeUrl('https://web.plaud.ai/x')).toBe(true);
    expect(looksLikeUrl('docs.google.com/document/d/1')).toBe(true);
    expect(looksLikeUrl('two words')).toBe(false);
    expect(looksLikeUrl('file.txt')).toBe(true);
  });

  it('recognises services, including Plaud', () => {
    expect(linkService('https://web.plaud.ai/s/1')).toBe('plaud');
    expect(linkService('https://app.plaud.ai/')).toBe('plaud');
    expect(linkService('https://notplaud.ai/')).toBe('web');
    expect(linkService('https://www.figma.com/design/1')).toBe('figma');
    expect(linkService('https://docs.google.com/document/d/1')).toBe('google');
  });

  it('suggests readable names', () => {
    expect(defaultLinkName('https://web.plaud.ai/s/abc', 'ru')).toBe('Запись Plaud');
    expect(defaultLinkName('https://example.com/blog/release-notes-2026', 'en')).toBe('release notes 2026');
    expect(defaultLinkName('https://example.com/d/9f8e7d6c5b4a39281706', 'en')).toBe('example.com');
  });
});

describe('files', () => {
  it('categorises by extension and mime type', () => {
    expect(fileCategory('mock.PNG')).toBe('image');
    expect(fileCategory('call.m4a')).toBe('audio');
    expect(fileCategory('spec.pdf')).toBe('pdf');
    expect(fileCategory('plan.xlsx')).toBe('sheet');
    expect(fileCategory('blob', 'video/mp4')).toBe('video');
    expect(fileCategory('unknown.bin')).toBe('other');
  });

  it('builds folder paths and unique names', () => {
    const f = (id: string, parentId?: string): FileNode => ({ id, kind: 'folder', name: id, parentId, createdAt: '', updatedAt: '' });
    const files = { a: f('a'), b: f('b', 'a'), c: f('c', 'b') };
    expect(folderPath('c', files).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(folderPath(undefined, files)).toEqual([]);
    expect(uniqueName('New folder', [f('New folder'), f('New folder 2')])).toBe('New folder 3');
    expect(uniqueName('Docs', [])).toBe('Docs');
  });
});
