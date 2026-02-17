import React, { useEffect, useMemo, useRef, useState } from "react";
import { generateAction } from "./model/thought";

import {
  DndContext,
  type DragEndEvent,
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
  const randomId = globalThis.crypto?.randomUUID?.();
  return (randomId ?? `id_${Date.now()}_${Math.random()}`).toString();
}

function loadInitialState(): { draft: string; items: ThoughtItem[] } {
  if (typeof window === "undefined") return { draft: "", items: [] };

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return { draft: "", items: [] };

    const parsed = JSON.parse(saved) as Partial<{ draft: unknown; items: unknown }>;
    const draft = typeof parsed.draft === "string" ? parsed.draft : "";
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(
          (item): item is ThoughtItem =>
            typeof item === "object" &&
            item !== null &&
            "id" in item &&
            "text" in item &&
            typeof (item as any).id === "string" &&
            typeof (item as any).text === "string"
        )
      : [];

    return { draft, items };
  } catch {
    return { draft: "", items: [] };
  }
}

/* =========================
   Swipe Row (iOS-like: no instant delete)
   ========================= */
function SwipeRow({ text, onDelete }: { text: string; onDelete: () => void }) {
  const startX = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const ACTION_W = 96;             // Delete領域の幅
  const OPEN_AT = 28;              // これ以上左に動いたら“開く”
  const MAX_LEFT = ACTION_W + 24;  // 引っ張りすぎ防止

  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));

  const close = () => setDx(0);
  const open = () => setDx(-ACTION_W);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || startX.current == null) return;
    const delta = e.clientX - startX.current;
    setDx(clamp(delta, -MAX_LEFT, 0));
  };

  const onPointerUp = () => {
    setDragging(false);

    // iOSっぽく：開く or 閉じる の2択でスナップ（即削除はしない）
    if (dx <= -OPEN_AT) open();
    else close();
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 12 }}>
      {/* 背景（アクション領域） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <button
          className="danger"
          onClick={() => {
            onDelete();
            close();
          }}
          style={{ width: ACTION_W, borderRadius: 0 }}
        >
          Delete
        </button>
      </div>

      {/* 前景（スワイプする行） */}
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
        // 開いてる時、タップしたら閉じる（iOSっぽい）
        onClick={() => {
          if (!dragging && dx !== 0) close();
        }}
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
        {/* iOSっぽい：ハンドル長押しでドラッグ開始（ここが掴みどころ） */}
        <span
          {...attributes}
          {...listeners}
          style={{
            padding: "10px",
            borderRadius: 10,
            background: "white",
            cursor: "grab",
            fontWeight: 800,

            // ここが重要：スクロール/スワイプ競合を減らす
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          aria-label="Reorder"
          role="button"
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
  const [initialState] = useState(loadInitialState);
  const [draft, setDraft] = useState(initialState.draft);
  const [items, setItems] = useState<ThoughtItem[]>(initialState.items);
  const [undo, setUndo] = useState<{ item: ThoughtItem; index: number } | null>(null);

  // 上部セグメントの現在位置（スワイプ追従）
  const [activeIndex, setActiveIndex] = useState(0);

  const undoTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);

  const goToPage = (index: number) => {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * index, behavior: "smooth" });
  };

  useEffect(() => {
    const id = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ draft, items }));
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

  // スワイプでページが動いたらセグメントを追従
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;

    const onScroll = () => {
      const w = el.clientWidth || 1;
      const idx = Math.round(el.scrollLeft / w);
      const clamped = Math.max(0, Math.min(2, idx));
      setActiveIndex(clamped);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
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

    setItems((prev) => [...prev, ...parts.map((t) => ({ id: makeId(), text: t }))]);

    setDraft("");
    requestAnimationFrame(() => goToPage(1));
  };

  const clearDraft = () => setDraft("");

  const resetAll = () => {
    if (!confirm("入力とリストをすべて消します。取り消し不可。続けるにゃ？")) return;

    setDraft("");
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const onShare = async () => {
    const text = [
      action ? `## 行動\n${action}\n` : "",
      thoughts.length ? `## 整理\n${thoughts.map((t) => `- ${t}`).join("\n")}` : "",
    ].join("\n");

    try {
      if (navigator.share) {
        await navigator.share({ title: "Seihai", text });
        return;
      }
    } catch {
      // Fallback to clipboard share below.
    }

    await navigator.clipboard.writeText(text);
    alert("コピーしたにゃ");
  };

  /* =========================
     iOSっぽい並び替え設定
     =========================
     - ハンドル長押しでドラッグ開始（誤爆しづらい）
     - 少しだけ動いてもスクロール判定になりにくい
  */
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,     // iOSっぽい“長押し開始”
        tolerance: 8,   // 指のブレは許容（開始しやすく）
      },
    }),
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 }, // マウスは軽めに
    })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((x) => x.id === active.id);
    const newIndex = items.findIndex((x) => x.id === over.id);

    setItems(arrayMove(items, oldIndex, newIndex));
  };

  return (
    <>
      {/* ======= 上部ナビ（セグメント） ======= */}
      <header className="topnav">
        <div className="topnav__title">Seihai</div>

        <div className="seg" data-index={activeIndex} role="tablist" aria-label="Seihai steps">
          <div className="seg__pill" aria-hidden="true" />
          {(["入力", "整理", "行動"] as const).map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={activeIndex === i}
              className="seg__btn"
              onClick={() => goToPage(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
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
                bottom: "calc(12px + env(safe-area-inset-bottom))",
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
    </>
  );
}
