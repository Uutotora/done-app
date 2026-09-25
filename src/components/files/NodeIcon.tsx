import {
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
  GitBranch,
  Globe,
  PenTool,
  Play,
  Presentation,
} from 'lucide-react';
import { fileCategory, linkService, type FileCategory } from '@/lib/files';
import type { FileNode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PlaudMark } from '../PlaudMark';

const CAT: Record<FileCategory, { icon: typeof FileIcon; color: string }> = {
  image: { icon: FileImage, color: 'purple' },
  audio: { icon: FileAudio, color: 'pink' },
  video: { icon: FileVideo, color: 'red' },
  pdf: { icon: FileText, color: 'red' },
  doc: { icon: FileText, color: 'blue' },
  sheet: { icon: FileSpreadsheet, color: 'green' },
  slides: { icon: Presentation, color: 'orange' },
  archive: { icon: FileArchive, color: 'brown' },
  code: { icon: FileCode, color: 'gray' },
  text: { icon: FileText, color: 'gray' },
  other: { icon: FileIcon, color: 'gray' },
};

/** Folder glyph in the spirit of macOS/Notion: a soft tinted folder. */
export function FolderGlyph({ size = 18, color = 'blue' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" data-color={color} className="shrink-0">
      <path d="M2.5 6.5A2 2 0 0 1 4.5 4.5h4.3a2 2 0 0 1 1.5.7l1.1 1.3h8.1a2 2 0 0 1 2 2V8H2.5z" fill="var(--tint-solid)" opacity="0.75" />
      <rect x="2.5" y="7.5" width="19" height="12" rx="2" fill="var(--tint-solid)" />
      <rect x="2.5" y="7.5" width="19" height="3" rx="1.5" fill="white" opacity="0.18" />
    </svg>
  );
}

export function NodeIcon({ node, size = 18, className }: { node: FileNode; size?: number; className?: string }) {
  if (node.kind === 'folder') return <FolderGlyph size={size} />;
  if (node.kind === 'link') {
    const service = linkService(node.url);
    if (service === 'plaud') return <PlaudMark size={size} />;
    const Icon = service === 'figma' ? PenTool : service === 'github' ? GitBranch : service === 'youtube' || service === 'loom' ? Play : Globe;
    const color =
      service === 'figma' ? 'purple' : service === 'google' ? 'blue' : service === 'youtube' ? 'red' : service === 'plane' ? 'blue' : 'gray';
    return (
      <span
        data-color={color}
        className={cn('tint inline-flex shrink-0 items-center justify-center rounded-[5px]', className)}
        style={{ width: size, height: size }}
      >
        <Icon size={size * 0.62} />
      </span>
    );
  }
  const cat = CAT[fileCategory(node.name, node.mime)];
  return (
    <span data-color={cat.color} className={cn('tint-text inline-flex shrink-0', className)}>
      <cat.icon size={size} strokeWidth={1.8} />
    </span>
  );
}
