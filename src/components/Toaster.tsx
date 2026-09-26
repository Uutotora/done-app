import { AnimatePresence, motion } from 'motion/react';
import { CircleCheck, CircleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { useUI, type Toast } from '@/lib/ui';

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const t = useT();
  const dismiss = useUI((s) => s.dismissToast);
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), toast.duration ?? (toast.action ? 6000 : 3200));
    return () => clearTimeout(id);
  }, [toast, dismiss]);
  return (
    <motion.div
      role="status"
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
      className="pointer-events-auto mx-3 max-w-[calc(100vw-24px)] flex min-h-10 items-center gap-3 rounded-lg bg-[#1f1f1f] py-2 pl-3 pr-2 text-[14px] text-white/90 shadow-lg dark:bg-[#373737]"
    >
      {toast.tone === 'success' && <CircleCheck size={16} className="text-[#4dab7a]" />}
      {toast.tone === 'error' && <CircleAlert size={16} className="text-[#eb5757]" />}
      <span className="max-w-[420px]">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
          className="rounded-md px-2 py-1 text-[13px] font-semibold text-[#6cb4ff] hover:bg-white/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        aria-label={t('common.close')}
        onClick={() => dismiss(toast.id)}
        className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
