import { useData } from './store';
import { putFileBlob, syncFileBlob, isRemoteStorage } from './storage';
import type { FileNode, ID } from './types';
import { nowIso, uid } from './utils';

export type FileCategory = 'image' | 'audio' | 'video' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'code' | 'text' | 'other';

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function fileCategory(name: string, mime = ''): FileCategory {
  const ext = extOf(name);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic'].includes(ext)) return 'image';
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'slides';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['js', 'ts', 'tsx', 'json', 'py', 'go', 'java', 'sql', 'yml', 'yaml', 'html', 'css'].includes(ext)) return 'code';
  if (mime.startsWith('text/') || ['txt', 'md', 'srt', 'vtt', 'log'].includes(ext)) return 'text';
  return 'other';
}

/** Adds https:// when someone pastes "web.plaud.ai/..." and rejects non-web schemes. */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
  const withScheme = hadScheme ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    // Bare words are not links; localhost only counts when typed with a scheme.
    if (!u.hostname.includes('.') && !(hadScheme && u.hostname === 'localhost')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function looksLikeUrl(text: string): boolean {
  const v = text.trim();
  return !/\s/.test(v) && (/^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) && normalizeUrl(v) !== null;
}

export function domainOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export type LinkService = 'plaud' | 'figma' | 'google' | 'notion' | 'plane' | 'github' | 'loom' | 'miro' | 'youtube' | 'web';

export function linkService(url?: string): LinkService {
  const d = domainOf(url);
  if (/(^|\.)plaud\.ai$/.test(d)) return 'plaud';
  if (/(^|\.)figma\.com$/.test(d)) return 'figma';
  if (/(^|\.)(docs|drive|sheets|slides)\.google\.com$/.test(d)) return 'google';
  if (/(^|\.)notion\.(so|site)$/.test(d)) return 'notion';
  if (/(^|\.)plane\.so$/.test(d)) return 'plane';
  if (/(^|\.)github\.com$/.test(d)) return 'github';
  if (/(^|\.)loom\.com$/.test(d)) return 'loom';
  if (/(^|\.)miro\.com$/.test(d)) return 'miro';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(d)) return 'youtube';
  return 'web';
}

/** A readable default name for a pasted link. */
export function defaultLinkName(url: string, lang: 'ru' | 'en'): string {
  const service = linkService(url);
  if (service === 'plaud') return lang === 'ru' ? 'Запись Plaud' : 'Plaud recording';
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    const pretty = last
      .replace(/[-_]+/g, ' ')
      .replace(/\.[a-z0-9]+$/i, '')
      .trim();
    return pretty && pretty.length > 2 && !/^[a-z0-9]{16,}$/i.test(pretty) ? pretty : u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export async function uploadFiles(files: File[], opts: { projectId?: ID; parentId?: ID }): Promise<ID[]> {
  if (isRemoteStorage()) {
    const { canEditProject } = await import('./auth');
    if (!canEditProject(opts.projectId)) throw new Error('Read-only access');
  }
  const ids: ID[] = [];
  for (const file of files) {
    if (isRemoteStorage() && file.size > 20 * 1024 * 1024) throw new Error('Maximum shared file size is 20 MB');
    const id = uid('f');
    if (!isRemoteStorage()) await putFileBlob(id, file);
    const ts = nowIso();
    const node: FileNode = {
      id,
      kind: 'file',
      projectId: opts.projectId,
      parentId: opts.parentId,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      createdAt: ts,
      updatedAt: ts,
    };
    useData.getState().addFile(node);
    try {
      await syncFileBlob(id, file);
    } catch (error) {
      useData.getState().deleteNodes([id]);
      throw error;
    }
    ids.push(id);
  }
  return ids;
}

/** Folder chain from the drive root down to `folderId`. */
export function folderPath(folderId: ID | undefined, files: Record<ID, FileNode>): FileNode[] {
  const out: FileNode[] = [];
  let cur = folderId ? files[folderId] : undefined;
  let guard = 0;
  while (cur && guard++ < 50) {
    out.unshift(cur);
    cur = cur.parentId ? files[cur.parentId] : undefined;
  }
  return out;
}

export function uniqueName(base: string, siblings: FileNode[]): string {
  const names = new Set(siblings.map((s) => s.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
