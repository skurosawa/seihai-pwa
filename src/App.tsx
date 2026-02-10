import React, { useEffect, useMemo, useRef, useState } from "react";
import { splitThoughts, generateAction } from "./model/thought";

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

// 旧キー（rawText保存）→ 移行用
const LEGACY_STORAGE_KEY = "seihai_v1_rawText";

// 新キー（draft + items をJSON保存）
const STORAGE_KEY = "seihai_v2_state";
const SAVE_DEBOUNCE_MS = 300;

type ThoughtItem = { id: string; text: string };

function makeId() {
  // SafariでもだいたいOK。古い環境ならフォールバック
  // @ts-ignore
  return (crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random()}`).toString();
}

/* =========================
   Swipe-to-delete row
   - 左スワイプでDelete表示
   - さらに左へ一定距離で即削除
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
    setDx(clamp(delta, -120, 0)); // 左のみ
  };

  const onPointerUp = () => {
    setDragging(false);

    // しきい値を超えたら削除
    if (dx < -90) {
      onDelete();
      setDx(0);
      return;
    }

    // ほどほどスワイプなら「Delete見せる」位置へ
    setDx(dx < -40 ? -96 : 0);
  };

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      {/* 背面（Delete背景） */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "stretch",
        }}
      >
        <button
          className="primary"
          onClick={onDelete}
          style={{
            width: 96,
            border: "none",
            color: "white",
            fontWeight: 700,
          }}
        >
          Delete
        </button>
      </div>

      {/* 前面（スワイプ対象） */}
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease",
          padding: "14px 12px",
          background: "white",
          touchAction: "pan-y", // 横は自前で扱う、縦スクロールは許可
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
   Sortable item (Drag handle)
   - 行スワイプと衝突しないように
     ドラッグはハンドル（☰）だけ
   - dnd-kitのidは一意（重複テキスト対策）
   ========================= */
function SortableItem({
  item,
  onDelete,
}: {
  item: ThoughtItem;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.75 : 1,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* Drag Handle */}
        <span
          {...attributes}
          {...listeners}
          aria-label="Drag handle"
          style={{
            padding: "10px 10px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.08)",
            background: "white",
            cursor: "grab",
            userSelect: "none",
            touchAction: "none", // 重要：ドラッグ中の誤スクロール抑制
            fontWeight: 800,
          }}
        >
          ☰
        </span>

        {/* Swipe Row */}
        <div style={{ flex: 1 }}>
          <SwipeRow text={item.text} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // ✅ 入力中（textarea）
  const [draft, setDraft] = useState("");

  // ✅ 思考リスト（id付き）
  const [items, setItems] = useState<ThoughtItem[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ✅ pager参照（追加後に整理ページへ移動）
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const goToPage = (index: number) => {
    const el = pagerRef.current;
    if (!el) return;
    const w = el.clientWidth; // 1ページ分の幅
    el.scrollTo({ left: w * index, behavior: "smooth" });
  };

  /* =========================
     起動時：localStorage復元
     - v2(JSON)があればそれを優先
     - なければ v1(rawText) から移行
     ========================= */
  useEffect(() => {
    try {
      const savedV2 = localStorage.getItem(STORAGE_KEY);
      if (savedV2) {
        const parsed = JSON.parse(savedV2) as {
          draft?: string;
          items?: ThoughtItem[];
        };
        if (typeof parsed.draft === "string") setDraft(parsed.draft);
        if (Array.isArray(parsed.items)) {
          setItems(
            parsed.items
              .filter((x) => x && typeof x.id === "string" && typeof x.text === "string")
              .map((x) => ({ id: x.id, text: x.text }))
          );
        }
        return;
      }

      // v1 から移行
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null) {
        const texts = splitThoughts(legacy);
        setItems(texts.map((t) => ({ id: makeId(), text: t })));
        setDraft("");
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {}
  }, []);

  /* =========================
     キーボード表示対策（iOS）
     ========================= */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", `${kb}px`);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  /* =========================
     自動保存（draft + items）
     ========================= */
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            draft,
            items,
          })
        );
      } catch {}
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(id);
  }, [draft, items]);

  /* =========================
     textarea 自動リサイズ（最大4行）
     ========================= */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 4 * 24; // lineHeight 24px想定
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [draft]);

  const thoughts = useMemo(() => items.map((x) => x.text), [items]);
  const action = useMemo(() => generateAction(thoughts), [thoughts]);

  const clearAll = () => {
    setDraft("");
    setItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
  };

  // ✅ 投稿：改行で分割して複数追加（空行は捨てる）→ 追加後に整理ページへ
  const addThoughtsFromDraft = () => {
    const v = draft.trim();
    if (!v) return;

    const parts = v
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts.length === 0) return;

    setItems((prev) => [...prev, ...parts.map((t) => ({ id: makeId(), text: t }))]);
    setDraft("");

    // ✅ 整理ページへ移動
    requestAnimationFrame(() => goToPage(1));
  };

  /* =========================
     DnD sensors
     ========================= */
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
    if (oldIndex < 0 || newIndex < 0) return;

    setItems(arrayMove(items, oldIndex, newIndex));
  };

  const deleteItem = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="pager" ref={pagerRef}>
      {/* ========== InputView ========== */}
      <div className="page">
        <h2>入力</h2>

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter = 投稿 / Shift+Enter = 改行
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addThoughtsFromDraft();
            }
          }}
          placeholder="Enterで追加 / Shift+Enterで改行（改行は分割して追加）"
          rows={1}
          style={{
            width: "100%",
            fontSize: "16px", // iOS拡大防止
            lineHeight: "24px",
            boxSizing: "border-box",
            resize: "none",
          }}
        />

        <div className="toolbar">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={addThoughtsFromDraft} disabled={!draft.trim()}>
              追加
            </button>
            <button onClick={clearAll}>全消去</button>
            <span style={{ opacity: 0.7, fontSize: 12 }}>
              ※入力・リストは自動保存されるにゃ
            </span>
          </div>
        </div>
      </div>

      {/* ========== ArrangeView ========== */}
      <div className="page">
        <h2>整理</h2>

        {items.length === 0 ? (
          <p style={{ opacity: 0.7 }}>まだ思考がないにゃ</p>
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
                    onDelete={() => deleteItem(it.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <p style={{ opacity: 0.7, fontSize: 12, marginTop: 12 }}>
          ・左スワイプで削除 / ☰ をドラッグで並び替え
        </p>
      </div>

      {/* ========== ActionView ========== */}
      <div className="page">
        <h2>行動</h2>
        {action ? <p>{action}</p> : <p style={{ opacity: 0.7 }}>まだないにゃ</p>}
      </div>
    </div>
  );
}
