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
   Swipe Row (iOS-like)
   - No instant delete
   - Swipe reveals Delete, tap to confirm
   - IMPORTANT: Only captures pointer AFTER horizontal intent is detected
     so long-press reorder can still work on the whole row.
   ========================= */
function SwipeRow({ text, onDelete }: { text: string; onDelete: () => void }) {
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const ACTION_W = 96;             // Delete領域の幅
  const OPEN_AT = 28;              // これ以上左なら開く
  const MAX_LEFT = ACTION_W + 24;  // 引っ張りすぎ防止
  const INTENT = 10;               // 横スワイプ意図判定（px）

  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));

  const close = () => {
    setSwiping(false);
    setDx(0);
    start.current = null;
  };
  const open = () => {
    setSwiping(false);
    setDx(-ACTION_W);
    start.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // ここでは capture しない（長押し並び替えを邪魔しない）
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;

    const { x, y } = start.current;
    const deltaX = e.clientX - x;
    const deltaY = e.clientY - y;

    // まだswipeモードじゃないなら、横スワイプ意図を判定
    if (!swiping) {
      const ax = Math.abs(deltaX);
      const ay = Math.abs(deltaY);

      // 横が明確に勝ったら swipe として扱う
      if (ax >= INTENT && ax > ay) {
        setSwiping(true);
        // swipe開始時点で pointer capture（ここからは削除スワイプが勝つ）
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        // swipe計算は左方向だけ
        setDx(clamp(deltaX, -MAX_LEFT, 0));
      } else {
        // 並び替え（長押し） or スクロールに任せる
        return;
      }
    } else {
      // swipe中：横移動でdx更新
      setDx(clamp(deltaX, -MAX_LEFT, 0));
    }
  };

  const onPointerUp = () => {
    if (!start.current) return;

    // swipeしてないなら何もしない（並び替え/タップに任せる）
    if (!swiping) {
      start.current = null;
      return;
    }

    // iOSっぽく：開く or 閉じる の2択
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
          transition: swiping ? "none" : "transform 180ms ease",
          padding: "14px 12px",
          background: "white",
          touchAction: "pan-y",
          userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // 開いてる時にタップで閉じる（iOSっぽい）
        onClick={() => {
          if (!swiping && dx !== 0) close();
        }}
      >
        {text}
      </div>
    </div>
  );
}

/* =========================
   Sortable Item (Whole-row long press reorder)
   - listeners/attributes are applied to the whole row wrapper
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
      {/* 行全体で長押し→並び替え（iOS寄り） */}
      <div
        {...attributes}
        {...listeners}
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          touchAction: "pan-y",
          userSelect: "none",
        }}
        aria-label="Reorder item"
      >
        {/* ハンドルは“見た目”として残す（行全体でドラッグできる） */}
        <span
          style={{
            padding: "10px",
            borderRadius: 10,
            background: "white",
            fontWeight: 800,
            opacity: 0.85,
          }}
          aria-hidden="true"
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
  const [undoVisible, setUndoVisible] = useState(false); // ★追加：トーストのin/out

  const [activeIndex, setActiveIndex] = useState(0);

  const [isDragging, setIsDragging] = useState(false);

  const undoTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);

  const savedScrollYRef = useRef(0);

  const lockScroll = () => {
    savedScrollYRef.current = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollYRef.current}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
  };

  const unlockScroll = () => {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
    window.scrollTo(0, savedScrollYRef.current);
  };

  useEffect(() => {
    if (!isDragging) return;

    const prevent = (e: TouchEvent) => {
      e.preventDefault();
    };

    document.addEventListener("touchmove", prevent, { passive: false });
    return () => {
      document.removeEventListener("touchmove", prevent);
    };
  }, [isDragging]);

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

  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;

    const onScroll = () => {
      const w = el.clientWidth || 1;
      const idx = Math.round(el.scrollLeft / w);
      setActiveIndex(Math.max(0, Math.min(2, idx)));
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const thoughts = useMemo(() => items.map((x) => x.text), [items]);
  const action = useMemo(() => generateAction(thoughts), [thoughts]);

  // ★変更：表示→一定時間後にout→削除（iOSっぽい）
  const showUndo = (payload: { item: ThoughtItem; index: number }) => {
    setUndo(payload);
    setUndoVisible(true);

    // 削除時の軽いフィードバック（効く端末だけ）
    if (navigator.vibrate) navigator.vibrate(20);

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoVisible(false);
      window.setTimeout(() => setUndo(null), 200);
    }, 3800);
  };

  const undoDelete = () => {
    if (!undo) return;
    const { item, index } = undo;

    setItems((prev) => {
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });

    setUndoVisible(false);
    window.setTimeout(() => setUndo(null), 200);

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

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 220,
        tolerance: 8,
      },
    }),
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
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

      <div className={`pager ${isDragging ? "is-dragging" : ""}`} ref={pagerRef}>
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

            <button className="outline" onClick={clearDraft} disabled={!draft.trim()}>
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
              onDragStart={() => {
                setIsDragging(true);
                lockScroll();
              }}
              onDragCancel={() => {
                setIsDragging(false);
                unlockScroll();
              }}
              onDragEnd={(e) => {
                setIsDragging(false);
                unlockScroll();
                onDragEnd(e);
              }}
            >
              <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                <div style={{ display: "grid", gap: 10, touchAction: "none" }}>
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

          {/* ★変更：iOS風ブラー・in/outアニメ（CSS側で .toast を定義する） */}
          {undo && (
            <div
              className={`toast ${undoVisible ? "toast--in" : "toast--out"}`}
              role="status"
              aria-live="polite"
            >
              <div className="toast__content">
                <span className="toast__text">削除したにゃ</span>

                <button className="toast__action" onClick={undoDelete} type="button">
                  取り消す
                </button>
              </div>
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
