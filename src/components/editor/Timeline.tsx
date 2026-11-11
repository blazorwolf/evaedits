"use client";
import {
  DndContext, PointerSensor, TouchSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { clipLength, type Clip } from "@/lib/types";
import { formatTime } from "./format";

const PX_PER_SEC = 28;
const MIN_W = 56;
const widthOf = (c: Clip) => Math.max(MIN_W, clipLength(c) * PX_PER_SEC);

interface Props {
  clips: Clip[];
  selectedId: string | null;
  playhead: number;
  onSelect: (id: string, timeInTimeline: number) => void;
  onReorder: (clips: Clip[]) => void;
  onToggleTransition: (id: string) => void;
}

export function Timeline({ clips, selectedId, playhead, onSelect, onReorder, onToggleTransition }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = clips.findIndex((c) => c.id === active.id);
    const to = clips.findIndex((c) => c.id === over.id);
    onReorder(arrayMove(clips, from, to));
  };

  // Where the playhead sits in pixels, given each clip's on-screen width.
  let px = 0;
  let acc = 0;
  for (const c of clips) {
    const len = clipLength(c);
    if (playhead <= acc + len) { px += (Math.max(0, playhead - acc) / len) * widthOf(c); break; }
    acc += len;
    px += widthOf(c) + GAP;
  }

  if (clips.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-neutral-300 text-sm text-neutral-500 dark:border-neutral-700">
        Import videos to start your timeline
      </div>
    );
  }

  let offset = 0;
  return (
    <div className="overflow-x-auto pb-2" data-testid="timeline">
      <div className="relative inline-flex items-stretch py-1" style={{ gap: GAP }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={clips.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {clips.map((c, i) => {
              const start = offset;
              offset += clipLength(c);
              return (
                <ClipBlock
                  key={c.id}
                  clip={c}
                  selected={c.id === selectedId}
                  isLast={i === clips.length - 1}
                  onSelect={(frac) => onSelect(c.id, start + frac * clipLength(c))}
                  onToggleTransition={() => onToggleTransition(c.id)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500"
          style={{ left: px }}
        />
      </div>
    </div>
  );
}

const GAP = 14;

function ClipBlock({ clip, selected, isLast, onSelect, onToggleTransition }: {
  clip: Clip; selected: boolean; isLast: boolean;
  onSelect: (fraction: number) => void; onToggleTransition: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, width: widthOf(clip) }}
      className={`relative shrink-0 ${isDragging ? "z-10 opacity-80" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        data-testid="clip"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSelect(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        }}
        className={`flex h-16 w-full touch-manipulation flex-col justify-between overflow-hidden rounded-lg px-2 py-1 text-left text-xs text-white ${
          selected ? "bg-violet-600 ring-2 ring-violet-300" : "bg-neutral-700"
        }`}
      >
        <span className="truncate font-medium">{clip.name}</span>
        <span className="flex items-center gap-1 opacity-80">
          {formatTime(clipLength(clip))}
          {clip.speed !== 1 && <span className="rounded bg-black/30 px-1">{clip.speed}×</span>}
        </span>
      </button>
      {!isLast && (
        <button
          onClick={onToggleTransition}
          aria-label={clip.transition === "fade" ? "Fade transition (tap for cut)" : "Straight cut (tap for fade)"}
          title={clip.transition === "fade" ? "Fade" : "Cut"}
          className={`absolute top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] ${
            clip.transition === "fade"
              ? "border-violet-400 bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200"
              : "border-neutral-300 bg-white text-neutral-500 dark:border-neutral-600 dark:bg-neutral-900"
          }`}
          style={{ right: -GAP / 2 - 12 }}
        >
          {clip.transition === "fade" ? "◐" : "|"}
        </button>
      )}
    </div>
  );
}
