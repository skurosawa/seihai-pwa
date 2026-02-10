import { useEffect, useMemo, useRef, useState } from "react";
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

const STORAGE_KEY = "seihai_v1_rawText";
const SAVE_DEBOUNCE_MS = 300;

/* =========================
   Swipe-to-delete row
   - 左スワイプでDelete表示
   - さらに左へ一定距離で即削除
   ========================= */
function SwipeRow({
  text,
  onDelete,
}: {
  text: string;
  onDelete: () => void;
}) {
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
   ========================= */
function SortableItem({
  id,
  onDelete,
}: {
  id: string;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

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
          <SwipeRow text={id} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [rawText, setRawText] = useState("");
  const [thoughts, setThoughts] = useState<string[]>([]);

  /* =========================
     起動時：localStorage復元
     ========================= */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        setRawText(saved);
        setThoughts(splitThoughts(saved));
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
     自動保存（rawTextのみ）
     ========================= */
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, rawText);
      } catch {}
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(id);
  }, [rawText]);

  /* =========================
     rawText → thoughts を同期
     - 入力が変わったら整理結果も更新
     - Arrangeで並び替え/削除したら rawText を逆反映して保持
       （次の入力で上書きされるのを防ぐため）
     ========================= */
  useEffect(() => {
    setThoughts(splitThoughts(rawText));
  }, [rawText]);

  const action = useMemo(() => generateAction(thoughts), [thoughts]);

  const clearAll = () => {
    setRawText("");
    setThoughts([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  // Arrange変更（削除/並び替え）→ rawTextへ反映（順序を保持して永続化するため）
  const commitThoughts = (next: string[]) => {
    setThoughts(next);
    setRawText(next.join("\n"));
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

    const oldIndex = thoughts.indexOf(active.id);
    const newIndex = thoughts.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const moved = arrayMove(thoughts, oldIndex, newIndex);
    commitThoughts(moved);
  };

  const deleteItem = (id: string) => {
    commitThoughts(thoughts.filter((t) => t !== id));
  };

  return (
    <div className="pager">
      {/* ========== InputView ========== */}
      <div className="page">
        <h2>入力</h2>

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="思考を改行で区切って書くにゃ…"
          style={{
            width: "100%",
            height: "65%",
            fontSize: "16px", // iOS拡大防止
            lineHeight: 1.6,
            boxSizing: "border-box",
            paddingBottom: "80px",
          }}
        />

        <div className="toolbar">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={clearAll}>全消去</button>
            <span style={{ opacity: 0.7, fontSize: 12 }}>
              ※入力は自動保存されるにゃ
            </span>
          </div>
        </div>
      </div>

      {/* ========== ArrangeView ========== */}
      <div className="page">
        <h2>整理</h2>

        {thoughts.length === 0 ? (
          <p style={{ opacity: 0.7 }}>まだ思考がないにゃ</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={thoughts} strategy={verticalListSortingStrategy}>
              <div style={{ display: "grid", gap: 10 }}>
                {thoughts.map((t) => (
                  <SortableItem key={t} id={t} onDelete={() => deleteItem(t)} />
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
