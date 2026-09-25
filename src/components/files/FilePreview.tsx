import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { getFileBlob } from '@/lib/storage';
import { fileCategory } from '@/lib/files';
import { formatLongDate } from '@/lib/dates';
import { deleteNodesWithUndo } from '@/lib/actions';
import { downloadBlob, formatBytes } from '@/lib/utils';
import { IconButton } from '../ui/Button';
import { Tooltip } from '../ui/Overlay';
import { NodeIcon } from './NodeIcon';

/** Full-screen lightbox for uploaded files, with arrow-key navigation between siblings. */
export function FilePreview() {
  const t = useT();
  const lang = useLang();
  const id = useUI((s) => s.previewId);
  const open = useUI((s) => s.openPreview);
  const files = useData((s) => s.files);
  const node = id ? files[id] : undefined;
  const [url, setUrl] = useState<string>();
  const [text, setText] = useState<string>();
  const [missing, setMissing] = useState(false);

  const siblings = useMemo(
    () =>
      node
        ? Object.values(files)
            .filter((f) => f.kind === 'file' && f.parentId === node.parentId && f.projectId === node.projectId)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [files, node],
  );
  const idx = node ? siblings.findIndex((s) => s.id === node.id) : -1;
  const cat = node ? fileCategory(node.name, node.mime) : 'other';

  useEffect(() => {
    setUrl(undefined);
    setText(undefined);
    setMissing(false);
    if (!node || node.kind !== 'file') return;
    let revoked: string | undefined;
    void getFileBlob(node.id).then(async (blob) => {
      if (!blob) {
        setMissing(true);
        return;
      }
      if (cat === 'text' || cat === 'code') setText((await blob.text()).slice(0, 200_000));
      revoked = URL.createObjectURL(blob);
      setUrl(revoked);
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [node, cat]);

  useEffect(() => {
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open(undefined);
      if (e.key === 'ArrowRight' && idx < siblings.length - 1) open(siblings[idx + 1].id);
      if (e.key === 'ArrowLeft' && idx > 0) open(siblings[idx - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, idx, siblings, open]);

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key="preview"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex flex-col bg-[rgba(15,15,15,0.86)] backdrop-blur-sm"
          onClick={() => open(undefined)}
        >
          <div className="flex h-14 shrink-0 items-center gap-3 px-4 text-white" onClick={(e) => e.stopPropagation()}>
            <NodeIcon node={node} size={20} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{node.name}</div>
              <div className="text-[12px] text-white/50">
                {node.size != null && formatBytes(node.size)} · {formatLongDate(node.createdAt, lang)}
              </div>
            </div>
            {url && cat === 'pdf' && (
              <Tooltip content={t('files.openInTab')}>
                <IconButton
                  size="md"
                  className="text-white/70 hover:bg-white/10 hover:text-white"
                  onClick={() => window.open(url, '_blank', 'noopener')}
                >
                  <ExternalLink size={17} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip content={t('common.download')}>
              <IconButton
                size="md"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={async () => {
                  const blob = await getFileBlob(node.id);
                  if (blob) downloadBlob(blob, node.name);
                }}
              >
                <Download size={17} />
              </IconButton>
            </Tooltip>
            <Tooltip content={t('common.delete')}>
              <IconButton
                size="md"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  open(undefined);
                  deleteNodesWithUndo([node.id]);
                }}
              >
                <Trash2 size={17} />
              </IconButton>
            </Tooltip>
            <IconButton
              size="md"
              className="text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => open(undefined)}
              label={t('common.close')}
            >
              <X size={19} />
            </IconButton>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-10">
            {idx > 0 && (
              <NavArrow side="left" onClick={() => open(siblings[idx - 1].id)}>
                <ChevronLeft size={22} />
              </NavArrow>
            )}
            <motion.div
              key={node.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-full max-w-full items-center justify-center"
            >
              {missing ? (
                <Fallback node={node} message={t('files.missing')} />
              ) : !url ? (
                <div className="h-16 w-16 animate-pulse rounded-xl bg-white/10" />
              ) : cat === 'image' ? (
                <img src={url} alt={node.name} className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl" />
              ) : cat === 'video' ? (
                <video src={url} controls autoPlay className="max-h-[80vh] max-w-full rounded-lg shadow-2xl" />
              ) : cat === 'audio' ? (
                <div className="flex w-[480px] flex-col items-center gap-5 rounded-2xl bg-white/5 p-8">
                  <NodeIcon node={node} size={56} />
                  <div className="text-center text-[15px] font-medium text-white">{node.name}</div>
                  <audio src={url} controls autoPlay className="w-full" />
                </div>
              ) : cat === 'pdf' ? (
                <iframe src={url} title={node.name} className="h-[82vh] w-[min(1000px,84vw)] rounded-lg bg-white shadow-2xl" />
              ) : text != null ? (
                <pre className="max-h-[80vh] w-[min(900px,84vw)] overflow-auto whitespace-pre-wrap rounded-lg bg-[#1e1e1e] p-6 font-mono text-[13px] leading-relaxed text-white/85 shadow-2xl">
                  {text}
                </pre>
              ) : (
                <Fallback node={node} message={t('files.noPreview')} />
              )}
            </motion.div>
            {idx >= 0 && idx < siblings.length - 1 && (
              <NavArrow side="right" onClick={() => open(siblings[idx + 1].id)}>
                <ChevronRight size={22} />
              </NavArrow>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NavArrow({ side, onClick, children }: { side: 'left' | 'right'; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 ${side === 'left' ? 'left-4' : 'right-4'}`}
    >
      {children}
    </button>
  );
}

function Fallback({ node, message }: { node: Parameters<typeof NodeIcon>[0]['node']; message: string }) {
  return (
    <div className="flex w-[360px] flex-col items-center gap-4 rounded-2xl bg-white/5 p-10 text-center">
      <NodeIcon node={node} size={56} />
      <div className="text-[15px] font-medium text-white">{node.name}</div>
      <div className="text-[13px] text-white/50">{message}</div>
    </div>
  );
}
