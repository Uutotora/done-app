import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertTriangle, Layers, StickyNote, Target, Type, UserRound, Wand2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useT } from '@/lib/i18n';
import { useIsDark, useDebouncedCallback } from '@/lib/hooks';
import { generateProjectMap } from '@/lib/mapgen';
import { STATUS_META } from '@/lib/constants';
import { descendantsOf, progressOf } from '@/lib/selectors';
import type { ID, MapEdge, MapNode, MapNodeKind } from '@/lib/types';
import { cn, uid } from '@/lib/utils';
import { Avatar, Chip, ProgressRing } from '@/components/ui/bits';
import { Dialog, Popover, Tooltip } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { OptionList } from '@/components/pickers/OptionList';
import { TypeIcon } from '@/components/pickers/icons';

type NodeData = { text?: string; itemId?: ID; personId?: ID };
type FlowNode = Node<NodeData, MapNodeKind>;

const EditCtx = createContext<(id: string, patch: Partial<NodeData>) => void>(() => undefined);

function toFlow(nodes: MapNode[]): FlowNode[] {
  return nodes.map((n) => ({ id: n.id, type: n.kind, position: { x: n.x, y: n.y }, data: { text: n.text, itemId: n.itemId, personId: n.personId } }));
}
function fromFlow(nodes: FlowNode[]): MapNode[] {
  return nodes.map((n) => ({
    id: n.id,
    kind: (n.type ?? 'note') as MapNodeKind,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    text: n.data.text,
    itemId: n.data.itemId,
    personId: n.data.personId,
  }));
}
const edgeStyle = { type: 'smoothstep' as const, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } };
function toEdges(edges: MapEdge[]): Edge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...edgeStyle }));
}

export default function ProjectMapView() {
  return (
    <ReactFlowProvider>
      <MapCanvas />
    </ReactFlowProvider>
  );
}

function MapCanvas() {
  const t = useT();
  const { projectId } = useParams();
  const dark = useIsDark();
  const project = useData((s) => s.projects[projectId!]);
  const saved = useData((s) => s.maps[projectId!]);
  const setMap = useData((s) => s.setMap);
  const flow = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(toFlow(saved?.nodes ?? []));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(saved?.edges ?? []));
  const [confirm, setConfirm] = useState(false);
  const firstRender = useRef(true);

  const persist = useDebouncedCallback((n: FlowNode[], e: Edge[]) => {
    setMap(projectId!, { nodes: fromFlow(n), edges: e.map((x) => ({ id: x.id, source: x.source, target: x.target })) });
  }, 400);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    persist(nodes, edges);
  }, [nodes, edges, persist]);

  const edit = useCallback(
    (id: string, patch: Partial<NodeData>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [setNodes],
  );

  const add = (kind: MapNodeKind, data: NodeData = {}) => {
    const box = document.querySelector('.react-flow')?.getBoundingClientRect();
    const center = flow.screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 800) / 2, y: (box?.top ?? 0) + (box?.height ?? 600) / 2 });
    const jitter = () => Math.round((Math.random() - 0.5) * 60);
    const node: FlowNode = {
      id: uid('n'),
      type: kind,
      position: { x: center.x - 110 + jitter(), y: center.y - 40 + jitter() },
      data,
      selected: true,
    };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
  };

  const regenerate = () => {
    if (!project) return;
    const gen = generateProjectMap(project, Object.values(useData.getState().items));
    setNodes(toFlow(gen.nodes));
    setEdges(toEdges(gen.edges));
    setConfirm(false);
    toast({ message: t('map.generated'), tone: 'success' });
    setTimeout(() => flow.fitView({ padding: 0.15, minZoom: 0.6, maxZoom: 1, duration: 500 }), 50);
  };

  const nodeTypes = useMemo(() => ({ goal: GoalNode, item: ItemNode, note: NoteNode, risk: RiskNode, person: PersonNode, text: TextNode }), []);

  return (
    <EditCtx.Provider value={edit}>
      <div className="relative min-h-0 flex-1 border-t border-line">
        <ReactFlow<FlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(c: Connection) => setEdges((es) => addEdge({ ...c, id: uid('e'), ...edgeStyle }, es))}
          defaultEdgeOptions={edgeStyle}
          fitView
          fitViewOptions={{ padding: 0.15, minZoom: 0.6, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={2}
          colorMode={dark ? 'dark' : 'light'}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--border-strong)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" nodeBorderRadius={6} maskColor={dark ? 'rgba(0,0,0,0.5)' : 'rgba(240,240,238,0.6)'} />
          <Panel position="top-left">
            <div className="flex items-center gap-0.5 rounded-xl bg-elevated p-1 shadow-md">
              <ToolButton icon={<Target size={16} />} label={t('map.addGoal')} onClick={() => add('goal', { text: '' })} />
              <ItemAdder projectId={projectId!} onPick={(itemId) => add('item', { itemId })} />
              <ToolButton icon={<StickyNote size={16} />} label={t('map.addNote')} onClick={() => add('note', { text: '' })} />
              <ToolButton icon={<AlertTriangle size={16} />} label={t('map.addRisk')} onClick={() => add('risk', { text: '' })} />
              <ToolButton icon={<UserRound size={16} />} label={t('map.addPerson')} onClick={() => add('person', { text: '' })} />
              <ToolButton icon={<Type size={16} />} label={t('map.addText')} onClick={() => add('text', { text: '' })} />
              <span className="mx-1 h-5 w-px bg-line" />
              <button
                onClick={() => (nodes.length ? setConfirm(true) : regenerate())}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-hover"
              >
                <Wand2 size={15} className="text-[var(--c-purple-text)]" />
                {t('map.generate')}
              </button>
            </div>
          </Panel>
          {nodes.length === 0 && (
            <Panel position="top-center">
              <div className="mt-24 max-w-[380px] rounded-xl bg-elevated/90 px-5 py-4 text-center text-[14px] text-fg-3 shadow-sm backdrop-blur">
                {t('map.empty')}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm} className="max-w-[420px]" title={t('map.generate')}>
        <div className="p-5">
          <div className="text-[15px] font-semibold">{t('map.generate')}</div>
          <p className="mt-2 text-[14px] text-fg-2">{t('map.generateConfirm')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={regenerate}>
              {t('common.apply')}
            </Button>
          </div>
        </div>
      </Dialog>
    </EditCtx.Provider>
  );
}

function ToolButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function ItemAdder({ projectId, onPick }: { projectId: ID; onPick: (id: ID) => void }) {
  const t = useT();
  const items = useData((s) => s.items);
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.projectId === projectId)
        .sort((a, b) => a.order - b.order)
        .map((i) => ({ value: i.id, label: i.title, icon: <TypeIcon type={i.type} size={14} /> })),
    [items, projectId],
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          aria-label={t('map.addItem')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover"
        >
          <Layers size={16} />
        </button>
      }
    >
      <OptionList
        options={options}
        placeholder={t('map.pickItem')}
        onSelect={(v) => {
          onPick(v);
          setOpen(false);
        }}
      />
    </Popover>
  );
}

/* ---------------------------------- Nodes ---------------------------------- */

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="target" position={Position.Left} id="l" />
    </>
  );
}

function EditableText({ id, value, placeholder, className }: { id: string; value?: string; placeholder: string; className?: string }) {
  const edit = useContext(EditCtx);
  const [editing, setEditing] = useState(!value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  });
  if (!editing) {
    return (
      <div onDoubleClick={() => setEditing(true)} className={cn('whitespace-pre-wrap break-words', !value && 'text-fg-4', className)}>
        {value || placeholder}
      </div>
    );
  }
  return (
    <textarea
      ref={ref}
      rows={1}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => {
        edit(id, { text: e.target.value });
        setEditing(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Escape') setEditing(false);
      }}
      className={cn('nodrag block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-fg-4', className)}
    />
  );
}

function GoalNode({ id, data, selected }: NodeProps<Node<NodeData, 'goal'>>) {
  const t = useT();
  return (
    <div
      className={cn(
        'w-[260px] rounded-2xl bg-gradient-to-br from-[#a1c4fd] via-[#c2e9fb] to-[#fbc2eb] p-[2px] shadow-md transition-shadow',
        selected && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg)]',
      )}
    >
      <div className="rounded-[14px] bg-elevated px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-fg-3">
          <Target size={13} /> {t('map.addGoal')}
        </div>
        <EditableText id={id} value={data.text} placeholder={t('map.goalPlaceholder')} className="text-[16px] font-semibold leading-snug" />
      </div>
      <Handles />
    </div>
  );
}

function ItemNode({ data, selected }: NodeProps<Node<NodeData, 'item'>>) {
  const t = useT();
  const item = useData((s) => (data.itemId ? s.items[data.itemId] : undefined));
  const items = useData((s) => s.items);
  const people = useData((s) => s.people);
  const openPeek = useUI((s) => s.openPeek);
  const prog = useMemo(() => (item ? progressOf(descendantsOf(item.id, Object.values(items))) : undefined), [item, items]);
  if (!item) {
    return (
      <div className="w-[240px] rounded-xl border border-dashed border-line-strong bg-elevated px-3 py-2.5 text-[13px] text-fg-4">
        {t('common.deleted')}
        <Handles />
      </div>
    );
  }
  const color = STATUS_META[item.status].color;
  return (
    <div
      data-peek-keep
      onDoubleClick={() => openPeek(item.id)}
      className={cn(
        'w-[240px] rounded-xl border border-line bg-elevated px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-accent',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-[2px]">
          <TypeIcon type={item.type} size={15} />
        </span>
        <div className={cn('min-w-0 flex-1 text-[14px] font-medium leading-snug', item.status === 'done' && 'text-fg-3 line-through')}>
          {item.title}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Chip color={color} dot>
          {t(`status.${item.status}`)}
        </Chip>
        {prog && prog.total > 0 && (
          <span className="flex items-center gap-1 text-[12px] text-fg-3">
            <ProgressRing value={prog.ratio} size={14} />
            {prog.done}/{prog.total}
          </span>
        )}
        <span className="flex-1" />
        {item.assigneeId && <Avatar person={people[item.assigneeId]} size={18} />}
      </div>
      <Handles />
    </div>
  );
}

function NoteNode({ id, data, selected }: NodeProps<Node<NodeData, 'note'>>) {
  const t = useT();
  return (
    <div
      data-color="yellow"
      className={cn(
        'tint w-[200px] rotate-[-1deg] rounded-md px-3 py-3 shadow-[0_6px_16px_rgba(15,15,15,0.12)] transition-transform hover:rotate-0',
        selected && 'ring-2 ring-accent',
      )}
    >
      <EditableText id={id} value={data.text} placeholder={t('map.notePlaceholder')} className="min-h-[60px] text-[14px] leading-snug text-fg" />
      <Handles />
    </div>
  );
}

function RiskNode({ id, data, selected }: NodeProps<Node<NodeData, 'risk'>>) {
  const t = useT();
  return (
    <div
      data-color="red"
      className={cn('w-[220px] rounded-xl border border-[var(--tint-solid)]/40 bg-elevated px-3 py-2.5 shadow-sm', selected && 'ring-2 ring-accent')}
    >
      <div className="tint-text mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide">
        <AlertTriangle size={13} /> {t('map.addRisk')}
      </div>
      <EditableText id={id} value={data.text} placeholder={t('map.riskPlaceholder')} className="text-[14px] leading-snug" />
      <Handles />
    </div>
  );
}

function PersonNode({ id, data, selected }: NodeProps<Node<NodeData, 'person'>>) {
  const t = useT();
  const people = useData((s) => s.people);
  const edit = useContext(EditCtx);
  const person = data.personId ? people[data.personId] : undefined;
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'flex w-[220px] items-center gap-2.5 rounded-full border border-line bg-elevated py-1.5 pl-1.5 pr-4 shadow-sm',
        selected && 'ring-2 ring-accent',
      )}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button className="nodrag shrink-0 rounded-full">
            <Avatar person={person} size={32} />
          </button>
        }
      >
        <OptionList
          options={Object.values(people).map((p) => ({ value: p.id, label: p.name, hint: p.role, icon: <Avatar person={p} size={16} /> }))}
          selected={data.personId}
          onSelect={(v) => {
            edit(id, { personId: v, text: data.text || `${people[v]?.name}${people[v]?.role ? `, ${people[v].role}` : ''}` });
            setOpen(false);
          }}
        />
      </Popover>
      <EditableText
        id={id}
        value={data.text}
        placeholder={t('map.personPlaceholder')}
        className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug"
      />
      <Handles />
    </div>
  );
}

function TextNode({ id, data, selected }: NodeProps<Node<NodeData, 'text'>>) {
  const t = useT();
  return (
    <div className={cn('min-w-[120px] max-w-[320px] rounded px-1', selected && 'ring-1 ring-accent')}>
      <EditableText id={id} value={data.text} placeholder={t('map.textPlaceholder')} className="text-[20px] font-bold tracking-[-0.01em]" />
      <Handles />
    </div>
  );
}
