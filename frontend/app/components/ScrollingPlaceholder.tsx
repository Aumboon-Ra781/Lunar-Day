'use client'

import { useLayoutEffect, useRef, useState } from 'react'

// placeholder ที่เลื่อนไป-กลับอัตโนมัติเมื่อข้อความยาวเกินช่อง (placeholder ปกติจะถูกตัดท้าย)
// วางเป็นพี่น้องของ <input> ภายใน element ที่เป็น position: relative แล้วตั้ง placeholder ของ input เป็น ''
// ตำแหน่ง/ฟอนต์อ่านจาก input จริง จึงตรงกับ padding และไอคอนของแต่ละหน้า
type Props = {
  inputRef: React.RefObject<HTMLInputElement | null>
  text: string
  hidden: boolean          // ซ่อนเมื่อมีข้อความในช่องแล้ว
  color?: string
}

type Box = { top: number; left: number; width: number; height: number; font: string; lineHeight: string }

const SPEED_PX_PER_SEC = 30
const PAUSE_SEC = 1.2

export default function ScrollingPlaceholder({ inputRef, text, hidden, color = 'rgba(255,255,255,0.35)' }: Props) {
  const [box, setBox] = useState<Box | null>(null)
  const [distance, setDistance] = useState(0)
  const textRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    const measure = () => {
      const cs = getComputedStyle(input)
      const px = (v: string) => parseFloat(v) || 0
      const left = input.offsetLeft + px(cs.borderLeftWidth) + px(cs.paddingLeft)
      const width = input.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
      setBox({
        top: input.offsetTop + px(cs.borderTopWidth),
        left, width: Math.max(0, width),
        height: input.clientHeight,
        font: cs.font, lineHeight: cs.lineHeight,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(input)
    return () => ro.disconnect()
  }, [inputRef])

  // วัดระยะที่ต้องเลื่อนหลังใส่ฟอนต์เดียวกับ input แล้ว
  useLayoutEffect(() => {
    const span = textRef.current
    if (!box || !span) return
    setDistance(Math.max(0, Math.ceil(span.scrollWidth - box.width)))
  }, [box, text, hidden])

  if (hidden) return null

  // เวลาเลื่อน 1 รอบ (ไป + กลับ) รวมช่วงหยุดที่หัวและท้าย
  const travel = distance / SPEED_PX_PER_SEC
  const duration = 2 * (travel + PAUSE_SEC)
  const pausePct = (PAUSE_SEC / duration) * 100

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', pointerEvents: 'none', overflow: 'hidden',
        display: 'flex', alignItems: 'center',
        top: box?.top ?? 0, left: box?.left ?? 0, width: box?.width ?? 0, height: box?.height ?? 0,
        visibility: box ? 'visible' : 'hidden',
      }}
    >
      {distance > 0 && (
        <style>{`
          @keyframes scrollPh-${distance} {
            0%, ${pausePct}% { transform: translateX(0); }
            50%, ${50 + pausePct}% { transform: translateX(-${distance}px); }
            100% { transform: translateX(0); }
          }
          @media (prefers-reduced-motion: reduce) { .scroll-ph-text { animation: none !important; } }
        `}</style>
      )}
      <span
        ref={textRef}
        className="scroll-ph-text"
        style={{
          whiteSpace: 'nowrap', color, font: box?.font, lineHeight: box?.lineHeight,
          animation: distance > 0 ? `scrollPh-${distance} ${duration}s ease-in-out infinite` : undefined,
        }}
      >
        {text}
      </span>
    </div>
  )
}
