import React, { useEffect, useMemo, useRef, useState } from "react";
import { generateAction } from "./model/thought";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// const LEGACY_STORAGE_KEY = "seihai_v1_rawText";
const STORAGE_KEY = "seihai_v2_state";
const SAVE_DEBOUNCE_MS = 300;

type ThoughtItem = { id: string; text: string };

function makeId() {
  // @ts-ignore
  return (crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random()}`).toString();
}

/* =========================
   Swipe Row
   ========================= */
function SwipeRow({ text, onDelete }: { text: string; onDelete: () => void }) {
  const startX = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || startX.current == null) return;
    const delta = e.clientX - startX.current;
    setDx(clamp(delta, -120, 0));
  };

  const onPointerUp = () => {
    setDragging(false);
    if (dx < -90) {
      onDelete();
      setDx(0);
      return;
    }
    setDx(dx < -40 ? -96 : 0);
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 12 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <button className="danger" onClick={onDelete} style={{ width: 96 }}>
          Delete
        </button>
      </div>

      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease",
          padding: "14px 12px",
          background: "white",
          touchAction: "pan-y",
          userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {text}
      </div>
    </div>
  );
}

/* =========================
   Sortable Item
   ========================= */
function SortableItem({
  item,
  onDelete,
}: {
  item: ThoughtItem;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span
          {...attributes}
          {...listeners}
          style={{
            padding: "10px",
            borderRadius: 10,
            background: "white",
            cursor: "grab",
            fontWeight: 800,
          }}
        >
          ☰
        </span>
        <div style={{ flex: 1 }}>
          <SwipeRow text={item.text} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<ThoughtItem[]>([]);
  const [undo, setUndo] = useState<{ item: ThoughtItem; index: number } | null>(null);

  const undoTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);

  const goToPage = (index: number) => {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * index, behavior: "smooth" });
  };

  /* =========================
     初期化
     ========================= */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setDraft(parsed.draft ?? "");
        setItems(parsed.items ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ draft, items })
      );
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(id);
  }, [draft, items]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 4 * 24) + "px";
  }, [draft]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const thoughts = useMemo(() => items.map((x) => x.text), [items]);
  const action = useMemo(() => generateAction(thoughts), [thoughts]);

  /* =========================
     操作
     ========================= */

  const showUndo = (payload: { item: ThoughtItem; index: number }) => {
    setUndo(payload);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndo(null), 5000);
  };

  const undoDelete = () => {
    if (!undo) return;
    const { item, index } = undo;

    setItems((prev) => {
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });

    setUndo(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  };

  const addThoughtsFromDraft = () => {
    const v = draft.trim();
    if (!v) return;

    const parts = v
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    setItems((prev) => [
      ...prev,
      ...parts.map((t) => ({ id: makeId(), text: t })),
    ]);

    setDraft("");
    requestAnimationFrame(() => goToPage(1));
  };

  const clearDraft = () => setDraft("");

  const resetAll = () => {
    if (!confirm("入力とリストをすべて消します。取り消し不可。続けるにゃ？"))
      return;

    setDraft("");
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const onShare = async () => {
    const text = [
      action ? `## 行動\n${action}\n` : "",
      thoughts.length
        ? `## 整理\n${thoughts.map((t) => `- ${t}`).join("\n")}`
        : "",
    ].join("\n");

    try {
      if (navigator.share) {
        await navigator.share({ title: "Seihai", text });
        return;
      }
    } catch {}

    await navigator.clipboard.writeText(text);
    alert("コピーしたにゃ");
  };

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 6 },
    }),
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const onDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((x) => x.id === active.id);
    const newIndex = items.findIndex((x) => x.id === over.id);

    setItems(arrayMove(items, oldIndex, newIndex));
  };

  return (
    <div className="pager" ref={pagerRef}>
      {/* ================= Input ================= */}
      <div className="page">
        <h2>入力</h2>

        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addThoughtsFromDraft();
            }
          }}
          placeholder="Enterで追加 / Shift+Enterで改行"
        />

        <div className="toolbar" style={{ display: "flex", gap: 8 }}>
          <button className="primary" onClick={addThoughtsFromDraft} disabled={!draft.trim()}>
            追加
          </button>

          <button onClick={clearDraft} disabled={!draft.trim()}>
            入力をクリア
          </button>

          <button className="danger" onClick={resetAll}>
            リセット
          </button>
        </div>
      </div>

      {/* ================= Arrange ================= */}
      <div className="page">
        <h2>整理</h2>

        {items.length === 0 ? (
          <p style={{ opacity: 0.6 }}>まだ思考がないにゃ</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={items.map((x) => x.id)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ display: "grid", gap: 10 }}>
                {items.map((it) => (
                  <SortableItem
                    key={it.id}
                    item={it}
                    onDelete={() => {
                      setItems((prev) => {
                        const index = prev.findIndex((x) => x.id === it.id);
                        if (index < 0) return prev;

                        const next = [...prev];
                        const [removed] = next.splice(index, 1);
                        if (removed) showUndo({ item: removed, index });

                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {undo && (
          <div
            style={{
              position: "fixed",
              left: 12,
              right: 12,
              bottom: 12,
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(0,0,0,0.85)",
              color: "white",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              zIndex: 9999,
            }}
          >
            <span style={{ fontSize: 14 }}>削除したにゃ</span>
            <button className="primary" onClick={undoDelete}>
              取り消す
            </button>
          </div>
        )}
      </div>

      {/* ================= Action ================= */}
      <div className="page">
        <h2>行動</h2>

        {action ? (
          <>
            <p>{action}</p>

            <div className="toolbar">
              <button className="primary" onClick={onShare}>
                共有
              </button>
            </div>
          </>
        ) : (
          <p style={{ opacity: 0.6 }}>まだないにゃ</p>
        )}
      </div>
    </div>
  );
}
