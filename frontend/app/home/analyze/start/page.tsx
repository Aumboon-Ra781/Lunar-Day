'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Fragment } from 'react'
import {
  Upload, ChevronRight, AlertCircle, CheckCircle2,
  Info, Sparkles, Activity, X, ImageIcon, Loader2,
  Shield, Zap, FlaskConical, Baby, Clock, Ruler
} from 'lucide-react'
import Navbar from '../../components/Navbar'
import { useToast } from '../../../components/Toast'
import RiskLegend from '../../../components/RiskLegend'
import { getRiskLevel } from '../../../lib/riskLevels'
import { apiBase, backendUrl } from '../../../lib/apiBase'
import { visuallyHidden } from '../../../lib/a11y'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type Step = 'upload' | 'symptoms' | 'analyzing' | 'result'

interface SymptomForm {
  flow: string          // q1
  duration: string      // q2
  cycle: string         // q3
  bleeding: string      // q4
  pain_level: string    // q5
  pelvic_pain: string   // q6
  symptoms: string[]    // q7
  sex_history: string   // q8
  is_pregnant: string   // q9
  size: string          // q10
}

const EMPTY_FORM: SymptomForm = {
  flow: '', duration: '', cycle: '', bleeding: '', pain_level: '',
  pelvic_pain: '', symptoms: [], sex_history: '', is_pregnant: '', size: '',
}

const PHOTO_ACCESS_NOTICE_KEY = 'analysis_photo_access_notice_seen'

function photoAccessNoticeKey() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null') as { id?: string | number } | null
    if (user?.id !== undefined && user.id !== null) return `${PHOTO_ACCESS_NOTICE_KEY}:${user.id}`
  } catch {}
  return `${PHOTO_ACCESS_NOTICE_KEY}:anonymous`
}

interface ImageResult {
  status: string
  ai_result: string
  detect_label: string
  confidence: number
  image_path: string | null
  visual_path?: string | null   // ภาพที่ backend วาดกรอบผล AI แล้ว
}

interface RiskResult {
  status: string
  Detect1: string
  Detect2: string
  Risk_Level: string
  Potential_Disease: string
  Recommendation: string
  saved: boolean
}


// value ตรงกับ ALLOWED_VALUES ใน backend/routes/analysis.py
const FLOW_OPTIONS = [            // q1
  { value: 'low',    label: 'น้อย' },
  { value: 'normal', label: 'ปกติ' },
  { value: 'high',   label: 'มาก' },
]
const DURATION_OPTIONS = [        // q2
  { value: 'short',  label: 'น้อยกว่า 4.5 วัน' },
  { value: 'normal', label: '4.5–8 วัน' },
  { value: 'long',   label: 'มากกว่า 8 วัน' },
]
const CYCLE_OPTIONS = [           // q3
  { value: 'short',  label: 'น้อยกว่า 24 วัน' },
  { value: 'normal', label: '24–38 วัน' },
  { value: 'long',   label: 'มากกว่า 38 วัน' },
]
const BLEEDING_OPTIONS = [        // q4
  { value: 'spotting',   label: 'เลือดออกกะปริบกะปรอย' },
  { value: 'postcoital', label: 'เลือดออกหลังมีเพศสัมพันธ์' },
  { value: 'none',       label: 'ไม่มีในลักษณะข้างต้น' },
]
const PAIN_OPTIONS = [            // q5
  { value: 'none',   label: 'ไม่มีอาการปวด' },
  { value: 'mild',   label: 'ปวดประจำเดือนเล็กน้อย' },
  { value: 'severe', label: 'ปวดประจำเดือนรุนแรง' },
]
const PELVIC_PAIN_OPTIONS = [     // q6
  { value: 'none',   label: 'ไม่มีอาการปวด' },
  { value: 'mild',   label: 'ปวดท้องน้อยเล็กน้อย' },
  { value: 'severe', label: 'ปวดท้องน้อยรุนแรง' },
]
const ASSOCIATED_SYMPTOM_OPTIONS = [  // q7
  { value: 'palpitation', label: 'ใจสั่น / หัวใจเต้นเร็ว' },
  { value: 'nausea',      label: 'คลื่นไส้ / อาเจียน' },
  { value: 'fever',       label: 'มีไข้' },
  { value: 'breast',      label: 'คัดเต้านม' },
  { value: 'urine',       label: 'ปัสสาวะบ่อย' },
  { value: 'bowel',       label: 'ท้องผูก / ท้องเสีย' },
  { value: 'discharge',   label: 'ตกขาวผิดปกติ' },
]
const SEX_HISTORY_OPTIONS = [     // q8
  { value: 'protected',   label: 'มีเพศสัมพันธ์ และป้องกันทุกครั้ง' },
  { value: 'unprotected', label: 'มีเพศสัมพันธ์ และไม่ได้ป้องกันทุกครั้ง' },
  { value: 'both',        label: 'มีเพศสัมพันธ์ ทั้งที่ป้องกันและไม่ได้ป้องกัน' },
  { value: 'failure',     label: 'มีเพศสัมพันธ์ แต่การป้องกันเกิดความผิดพลาด เช่น ถุงยางแตก/หลุด' },
  { value: 'no_sex',      label: 'ไม่เคยมีเพศสัมพันธ์' },
]
const PREGNANCY_OPTIONS = [       // q9
  { value: 'pregnant',     label: 'ตั้งครรภ์' },
  { value: 'not_pregnant', label: 'ไม่ตั้งครรภ์' },
  { value: 'unsure',       label: 'ไม่แน่ใจ' },
]
const SIZE_OPTIONS = [            // q10
  { value: 'small', label: 'เล็กกว่าหรือเท่ากับเหรียญสิบ' },
  { value: 'large', label: 'ใหญ่กว่าเหรียญสิบ' },
]

// ข้อ 9 (การตรวจการตั้งครรภ์) แสดงเมื่อ
// - ข้อ 8 ตอบแล้วและไม่ใช่ "ไม่เคยมีเพศสัมพันธ์" หรือ
// - ข้อ 4 เลือก "เลือดออกหลังมีเพศสัมพันธ์"
function needsPregnancyQuestion(f: SymptomForm) {
  return (!!f.sex_history && f.sex_history !== 'no_sex') || f.bleeding === 'postcoital'
}
// ข้อ 9 ไม่ต้องตอบแล้ว → ล้างคำตอบที่เคยเลือกไว้
function resetPregnancyIfHidden(f: SymptomForm): SymptomForm {
  return needsPregnancyQuestion(f) ? f : { ...f, is_pregnant: '' }
}


// แสดงค่าความมั่นใจที่ backend ส่งมาทุกกรณี (รวมถึงกรณีไม่พบลิ่มเลือด/เนื้อเยื่อ)
function confidenceText(r: { confidence: number | null | undefined }) {
  return typeof r.confidence === 'number' ? `${r.confidence.toFixed(1)}%` : '–'
}

// แยกคำแนะนำเป็นข้อ ๆ แล้วตัดข้อที่ซ้ำกันออก (เทียบหลังตัดช่องว่างเกิน) เหลือข้อละครั้ง
function uniqueSuggestions(text: string): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const part of text.split(/[·•\n]/)) {
    const item = part.replace(/\s+/g, ' ').trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    items.push(item)
  }
  return items
}
// สีของผล "ไม่พบโรค" (ไม่อยู่ในตารางระดับความเสี่ยง)
const NO_MATCH_STYLE = { tint: '#f8fafc', solid: '#94a3b8', ink: '#475569', icon: 'ℹ️', meaning: '' }

// ─────────────────────────────────────────────
// Analyzing screen
// ─────────────────────────────────────────────
const ANALYZING_STEPS = [
  { label: 'ประมวลผลภาพ',        icon: '🔬' },
  { label: 'วิเคราะห์ลิ่มเลือด', icon: '🩸' },
  { label: 'ประเมินความเสี่ยง',  icon: '📊' },
  { label: 'สรุปผลการวิเคราะห์', icon: '✅' },
]

function AnalyzingScreen() {
  const steps = ANALYZING_STEPS
  const [active, setActive] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setActive(a => Math.min(a + 1, ANALYZING_STEPS.length - 1)), 1200)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={{ textAlign: 'center', padding: '56px 20px' }}>
      <div style={{
        width: 88, height: 88, borderRadius: '50%', margin: '0 auto 28px',
        background: 'linear-gradient(135deg,rgba(240,98,146,0.15),rgba(194,24,91,0.2))',
        border: '2px solid rgba(240,98,146,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, animation: 'analyzePulse 1.5s ease-in-out infinite',
      }}>🔬</div>
      <h3 style={{ fontFamily: "'Mitr',sans-serif", fontSize: 18, color: '#1a0a14', marginBottom: 6 }}>
        กำลังวิเคราะห์...
      </h3>
      <p style={{ fontSize: 13, color: '#9e7a8a', marginBottom: 32 }}>
        AI กำลังประมวลผลข้อมูลของคุณ กรุณารอสักครู่
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340, margin: '0 auto' }}>
        {steps.map((s, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 14px', borderRadius: 12,
            background: i <= active ? 'rgba(194,24,91,0.06)' : '#f9f9f9',
            border: `1px solid ${i <= active ? 'rgba(194,24,91,0.2)' : '#f0f0f0'}`,
            transition: 'all 0.4s ease',
          }}>
            <span style={{ fontSize: 16 }}>{s.icon}</span>
            <span style={{
              fontFamily: "'Sarabun',sans-serif", fontSize: 13,
              color: i <= active ? '#c2185b' : '#b0b0b0', flex: 1, textAlign: 'left',
            }}>{s.label}</span>
            {i < active  && <CheckCircle2 size={15} color="#c2185b" />}
            {i === active && <Loader2 size={15} color="#c2185b" style={{ animation: 'spin 1s linear infinite' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Radio group
// ─────────────────────────────────────────────
function RadioGroup({
  options, value, onChange, name, disabled = false,
}: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; name: string; disabled?: boolean }) {
  return (
    <div aria-disabled={disabled} style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 0.2s',
    }}>
      {options.map(opt => (
        <label key={opt.value} className="opt-label" style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '11px 14px', borderRadius: 12, cursor: 'pointer',
          border: `1.5px solid ${value === opt.value ? '#f06292' : '#f5e6ec'}`,
          background: value === opt.value
            ? 'linear-gradient(135deg,rgba(252,228,236,0.6),rgba(248,187,208,0.3))'
            : '#faf7f5',
          transition: 'all 0.18s',
        }}>
          <input type="radio" name={name} value={opt.value}
            checked={value === opt.value}
            disabled={disabled}
            onChange={() => onChange(opt.value)}
            style={visuallyHidden} />
          <div style={{
            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
            border: `2px solid ${value === opt.value ? '#f06292' : '#f5c6d8'}`,
            background: value === opt.value ? '#f06292' : '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.18s',
          }}>
            {value === opt.value && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
          </div>
          <span style={{
            fontFamily: "'Sarabun',sans-serif", fontSize: 14,
            color: value === opt.value ? '#c2185b' : '#5a3a4a',
            fontWeight: value === opt.value ? 500 : 400,
          }}>{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// Checkbox group (เลือกได้หลายข้อ)
// ─────────────────────────────────────────────
function CheckboxGroup({
  options, values, onChange,
}: { options: { value: string; label: string }[]; values: string[]; onChange: (v: string[]) => void }) {
  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 8 }}>
      {options.map(opt => {
        const checked = values.includes(opt.value)
        return (
          <label key={opt.value} className="opt-label" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '11px 14px', borderRadius: 12, cursor: 'pointer',
            border: `1.5px solid ${checked ? '#f06292' : '#f5e6ec'}`,
            background: checked
              ? 'linear-gradient(135deg,rgba(252,228,236,0.6),rgba(248,187,208,0.3))'
              : '#faf7f5',
            transition: 'all 0.18s',
          }}>
            <input type="checkbox" value={opt.value}
              checked={checked}
              onChange={() => toggle(opt.value)}
              style={visuallyHidden} />
            <div style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              border: `2px solid ${checked ? '#f06292' : '#f5c6d8'}`,
              background: checked ? '#f06292' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.18s',
            }}>
              {checked && <div style={{ width: 6, height: 6, borderRadius: 2, background: '#fff' }} />}
            </div>
            <span style={{
              fontFamily: "'Sarabun',sans-serif", fontSize: 14,
              color: checked ? '#c2185b' : '#5a3a4a',
              fontWeight: checked ? 500 : 400,
            }}>{opt.label}</span>
          </label>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function AnalyzePage() {
  const [mounted,    setMounted]   = useState(false)
  const [step,       setStep]      = useState<Step>('upload')
  const [image,      setImage]     = useState<string | null>(null)   // ภาพจากเครื่อง (แสดงในหน้าอัปโหลด)
  const [aiImage,    setAiImage]   = useState<string | null>(null)   // ภาพที่ AI วาดกรอบ (แสดงในหน้าระบุอาการ)
  const [dragOver,   setDragOver]  = useState(false)
  const [showPhotoAccessNotice, setShowPhotoAccessNotice] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const seenPhotoAccessNoticeKeys = useRef(new Set<string>())
  const uploadSeq = useRef(0)  // นับรอบการเลือกรูป กันผลของรูปเก่ามาทับรูปใหม่
  const [imageValidated,    setImageValidated]    = useState(false)
  // ข้อความจาก backend ทั้งหมดแสดงผ่าน toast กลาง (components/Toast)
  const showToast = useToast()
  const flashError = useCallback((msg: string) => showToast(msg, 'error'), [showToast])

  const [form, setForm] = useState<SymptomForm>(EMPTY_FORM)

  const [imageResult, setImageResult] = useState<ImageResult | null>(null)
  const [riskResult,  setRiskResult]  = useState<RiskResult  | null>(null)
  const [imageLoading, setImageLoading] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const openImagePicker = () => {
    const input = fileRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  const handleChooseImage = () => {
    const noticeKey = photoAccessNoticeKey()
    let hasSeenNotice = seenPhotoAccessNoticeKeys.current.has(noticeKey)
    if (!hasSeenNotice) {
      try { hasSeenNotice = localStorage.getItem(noticeKey) === 'seen' } catch {}
    }
    if (hasSeenNotice) {
      openImagePicker()
      return
    }

    seenPhotoAccessNoticeKeys.current.add(noticeKey)
    try { localStorage.setItem(noticeKey, 'seen') } catch {}
    setShowPhotoAccessNotice(true)
  }

  const handleFile = useCallback(async (file: File) => {
    // ไม่กรองชนิดไฟล์ที่ฝั่งหน้าเว็บ — ส่งให้ backend ตรวจนามสกุลและแจ้งข้อความเอง (A2)
    setImageValidated(false)
    setImageResult(null)
    setAiImage(null)
    const seq = ++uploadSeq.current
    const reader = new FileReader()
    reader.onload = e => {
      if (uploadSeq.current === seq) setImage(e.target?.result as string)
    }
    // แสดงตัวอย่างเฉพาะไฟล์รูปภาพ (ไฟล์อื่นรอผลตรวจจาก backend)
    if (file.type.startsWith('image/')) reader.readAsDataURL(file)

    const token = localStorage.getItem('access_token')
    if (!token) { showToast('กรุณาเข้าสู่ระบบก่อนใช้งานฟีเจอร์นี้', 'info'); return }
    setImageLoading(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res  = await fetch(`${apiBase()}/analysis/image`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
      if (res.status === 401 || res.status === 422) {
        localStorage.removeItem('access_token')
        setImage(null)
        flashError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
        return
      }
      const data: ImageResult = await res.json()
      if (data.status !== 'success') {
        const err = data as unknown as { msg?: string }
        // ใช้ข้อความจาก backend ก่อน ถ้าไม่มีจึงใช้ข้อความสำรอง
        flashError(err.msg || 'รูปภาพไม่ถูกต้อง กรุณาอัปโหลดรูปใหม่')
        // เอารูปเดิมออก และล้าง input เพื่อให้เลือกรูปใหม่ (หรือไฟล์เดิม) ได้ทันที
        reader.abort()
        if (fileRef.current) fileRef.current.value = ''
        setImage(null); setImageValidated(false)
      } else {
        setImageResult(data); setImageValidated(true)
        if (data.visual_path) {
          // โหลดภาพผล AI ให้เสร็จก่อนค่อยใช้ในหน้าระบุอาการ ถ้าโหลดไม่ได้ให้ใช้ภาพจากเครื่องแทน
          // (หน้าอัปโหลดแสดงภาพจากเครื่องเสมอ)
          const visualUrl = backendUrl(data.visual_path)
          const probe = new window.Image()
          probe.onload = () => {
            if (uploadSeq.current !== seq) return
            setAiImage(visualUrl)
          }
          probe.src = visualUrl
        }
        if (data.ai_result !== 'clot') setForm(f => ({ ...f, size: '' }))
      }
    } catch {
      flashError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้')
      setImage(null)
    } finally { setImageLoading(false) }
  }, [flashError, showToast])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]; if (file) handleFile(file)
  }

  const formValid = (() => {
    if (imageLoading || !imageResult) return false
    if (!form.flow || !form.duration || !form.cycle || !form.bleeding ||
        !form.pain_level || !form.pelvic_pain || !form.sex_history) return false
    // ข้อ 9 ต้องตอบเมื่อแสดงอยู่ (backend ต้องการ q9 เมื่อ q8 ≠ no_sex)
    if (needsPregnancyQuestion(form) && !form.is_pregnant) return false
    if (imageResult?.ai_result === 'clot' && !form.size) return false
    return true
  })()

  const goToSymptoms = () => {
    if (!imageValidated || !imageResult) return
    if (imageResult.ai_result !== 'clot') setForm(f => ({ ...f, size: '' }))
    setStep('symptoms')
  }

  const runAnalysis = async () => {
    const token = localStorage.getItem('access_token')
    if (!token) { showToast('กรุณาเข้าสู่ระบบก่อนใช้งานฟีเจอร์นี้', 'info'); return }
    if (!formValid) return
    setStep('analyzing')
    try {
      const fd = new FormData()
      fd.append('aiResult',   imageResult?.ai_result ?? '')
      fd.append('imagePath',  imageResult?.image_path ?? '')
      fd.append('confidence', String(imageResult?.confidence ?? ''))
      fd.append('q1', form.flow)
      fd.append('q2', form.duration)
      fd.append('q3', form.cycle)
      fd.append('q4', form.bleeding)
      fd.append('q5', form.pain_level)
      fd.append('q6', form.pelvic_pain)
      form.symptoms.forEach(s => fd.append('q7', s))
      fd.append('q8', form.sex_history)
      if (needsPregnancyQuestion(form) && form.is_pregnant) fd.append('q9', form.is_pregnant)
      if (imageResult?.ai_result === 'clot' && form.size) fd.append('q10', form.size)
      const res  = await fetch(`${apiBase()}/analysis/risk`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
      if (res.status === 401 || res.status === 422) {
        localStorage.removeItem('access_token')
        flashError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); setStep('symptoms')
        return
      }
      const data = await res.json()
      // กรณีไม่พบโรคที่สอดคล้อง backend ตอบ success พร้อมระดับ "ไม่พบความเสี่ยงที่ชัดเจน" และคำแนะนำมาเอง
      if (data.status !== 'success') {
        flashError(data.msg ?? 'ประเมินความเสี่ยงไม่สำเร็จ'); setStep('symptoms')
      } else {
        // backend ส่งผลมาใน data.data (snake_case) → แปลงเป็นรูปแบบที่หน้าจอใช้
        const d = data.data
        setRiskResult({
          status:            data.status,
          Detect1:           d.detect1,
          Detect2:           d.detect2,
          Risk_Level:        d.risk_level,
          Potential_Disease: d.potential_disease,
          Recommendation:    d.recommendation ?? '',
          saved:             true,
        })
        setStep('result')
      }
    } catch { flashError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'); setStep('symptoms') }
  }

  const rc = getRiskLevel(riskResult?.Risk_Level) ?? NO_MATCH_STYLE

  const resetAll = () => {
    setStep('upload'); setImage(null); setAiImage(null)
    setImageResult(null); setRiskResult(null); setImageLoading(false)
    setForm(EMPTY_FORM)
    setImageValidated(false)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Mitr:wght@300;400;500;600&family=Sarabun:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .analyze-root {
          --page-max: 960px;
          --page-pad: clamp(20px, 4vw, 48px);
          min-height: 100vh;
          font-family: 'Sarabun', sans-serif;
          background: #faf7f5;
          /* clip (ไม่ใช่ hidden) เพื่อไม่ให้แถบเมนู position: sticky หลุด */
          overflow-x: clip;
        }

        /* ── Header ── */
        .analyze-header {
          background: linear-gradient(135deg, #1a0a14 0%, #3d1a2e 50%, #6b2646 100%);
          padding: 48px var(--page-pad) 68px;
          position: relative;
          overflow: hidden;
        }
        .ah-circle-1 { position: absolute; width: 420px; height: 420px; top: -160px; right: -80px; border-radius: 50%; background: radial-gradient(circle, rgba(244,143,177,0.18), transparent 60%); }
        .ah-circle-2 { position: absolute; width: 260px; height: 260px; bottom: -90px; left: 15%; border-radius: 50%; background: radial-gradient(circle, rgba(206,147,216,0.12), transparent 60%); }
        .ah-dots { position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px); background-size: 26px 26px; }
        .ah-arc { position: absolute; bottom: -1px; left: 0; right: 0; height: 52px; background: #faf7f5; clip-path: ellipse(55% 100% at 50% 100%); }
        .ah-content { position: relative; z-index: 2; max-width: var(--page-max); margin: 0 auto; opacity: 0; transform: translateY(20px); transition: opacity 0.7s ease, transform 0.7s ease; }
        .ah-content.visible { opacity: 1; transform: translateY(0); }
        .ah-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 999px; background: rgba(240,98,146,0.18); border: 1px solid rgba(240,98,146,0.35); font-family: 'Mitr', sans-serif; font-size: 11.5px; color: #f8bbd0; letter-spacing: 0.5px; margin-bottom: 16px; }
        .ah-title { font-family: 'Mitr', sans-serif; font-weight: 600; font-size: clamp(22px, 3.6vw, 38px); color: #fff; line-height: 1.3; margin-bottom: 10px; max-width: 640px; }
        .ah-title span { background: linear-gradient(135deg, #f48fb1, #f06292); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .ah-sub { font-size: 14px; color: rgba(255,255,255,0.55); line-height: 1.6; max-width: 540px; }

        /* ── Step bar ── */
        .step-bar { max-width: var(--page-max); margin: -24px auto 0; padding: 0 var(--page-pad); position: relative; z-index: 10; }
        .step-track {
          display: flex; align-items: center;
          background: #fff; border-radius: 16px;
          border: 1px solid #f5e6ec;
          box-shadow: 0 8px 32px rgba(194,24,91,0.1);
          padding: 16px 20px; gap: 0;
          overflow-x: auto;
        }
        .step-node { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .step-circle {
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Mitr', sans-serif; font-size: 12.5px; font-weight: 600;
          flex-shrink: 0; transition: all 0.3s ease;
        }
        .step-circle.done   { background: linear-gradient(135deg, #f06292, #c2185b); color: #fff; box-shadow: 0 4px 12px rgba(194,24,91,0.35); }
        .step-circle.active { background: linear-gradient(135deg, #f06292, #c2185b); color: #fff; box-shadow: 0 4px 16px rgba(194,24,91,0.45); animation: stepPulse 2s ease-in-out infinite; }
        .step-circle.idle   { background: #f5e6ec; color: #c2a0b0; }
        @keyframes stepPulse {
          0%, 100% { box-shadow: 0 4px 16px rgba(194,24,91,0.45); }
          50%       { box-shadow: 0 4px 24px rgba(194,24,91,0.7); }
        }
        .step-label { font-family: 'Mitr', sans-serif; font-size: 12px; min-width: 0; }
        /* แสดงชื่อขั้นตอนเต็ม ไม่ตัดเป็น "..." */
        .step-label-main { color: #1a0a14; white-space: nowrap; }
        .step-label-sub  { font-size: 10.5px; color: #9e7a8a; font-family: 'Sarabun', sans-serif; white-space: nowrap; }
        .step-connector { width: 32px; height: 2px; border-radius: 1px; background: #f5e6ec; flex-shrink: 0; margin: 0 8px; transition: background 0.3s ease; }
        .step-connector.done { background: linear-gradient(90deg, #f06292, #c2185b); }

        /* ── Main ── */
        .analyze-main { max-width: var(--page-max); margin: 28px auto 56px; padding: 0 var(--page-pad); }
        .main-card { background: #fff; border-radius: 22px; border: 1px solid #f5e6ec; box-shadow: 0 8px 40px rgba(194,24,91,0.08); overflow: hidden; }

        /* Card header */
        .card-section-title { display: flex; align-items: center; gap: 12px; padding: 30px 32px 0; }
        .cst-icon { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, #fce4ec, #f8bbd0); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .cst-text { font-family: 'Mitr', sans-serif; font-size: 16px; font-weight: 600; color: #1a0a14; }
        .cst-sub  { font-size: 12.5px; color: #9e7a8a; font-family: 'Sarabun', sans-serif; }

        /* Upload zone */
        .upload-zone {
          margin: 20px 32px;
          border: 2px dashed #f5c6d8; border-radius: 18px;
          min-height: 240px;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
          cursor: pointer; background: #fdf9fb;
          transition: all 0.2s ease; position: relative; overflow: hidden;
          padding: 28px 20px;
        }
        .upload-zone:hover, .upload-zone.drag-over { border-color: #f06292; background: linear-gradient(135deg, rgba(252,228,236,0.4), rgba(248,187,208,0.2)); }
        .upload-zone-icon { width: 64px; height: 64px; border-radius: 18px; background: linear-gradient(135deg, #fce4ec, #f8bbd0); display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(194,24,91,0.2); }
        .upload-zone-title { font-family: 'Mitr', sans-serif; font-size: 15px; color: #1a0a14; text-align: center; }
        .upload-zone-sub { font-size: 12.5px; color: #9e7a8a; text-align: center; line-height: 1.5; }
        .upload-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 999px; background: linear-gradient(135deg, #f06292, #c2185b); color: #fff; font-family: 'Mitr', sans-serif; font-size: 13px; font-weight: 500; box-shadow: 0 4px 16px rgba(194,24,91,0.35); }

        .photo-access-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(26,10,20,0.55); backdrop-filter: blur(4px); }
        .photo-access-dialog { width: min(100%, 420px); padding: 28px; border-radius: 22px; background: #fff; box-shadow: 0 20px 60px rgba(26,10,20,0.25); display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
        .photo-access-icon { width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, #fce4ec, #f8bbd0); display: flex; align-items: center; justify-content: center; }
        .photo-access-title { font-family: 'Mitr', sans-serif; font-size: 18px; font-weight: 600; color: #1a0a14; }
        .photo-access-message { font-size: 13px; color: #7a5a6a; line-height: 1.7; }
        .photo-access-actions { display: flex; gap: 12px; width: 100%; margin-top: 6px; }
        .photo-access-actions button { flex: 1; justify-content: center; }
        .photo-access-cancel { padding: 13px 16px; border: 1.5px solid rgba(194,24,91,0.2); border-radius: 14px; background: transparent; color: #c2185b; font-family: 'Mitr', sans-serif; font-size: 14px; cursor: pointer; }

        /* Image preview */
        .img-preview { margin: 20px 32px; border-radius: 18px; overflow: hidden; position: relative; border: 2px solid #f5e6ec; }
        .img-preview img { width: 100%; max-height: 320px; object-fit: cover; display: block; }
        .img-preview-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(26,10,20,0.5), transparent 50%); display: flex; align-items: flex-end; padding: 16px; }
        /* หน้าระบุอาการ: แสดงทั้งภาพ (ไม่ครอป) บนพื้นอ่อน */
        .img-preview--symptoms { background: #faf7f5; }
        .img-preview--symptoms img { max-height: 260px; object-fit: contain; }
        .img-preview-tag { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); padding: 5px 11px; border-radius: 9px; font-family: 'Mitr', sans-serif; font-size: 11.5px; color: #c2185b; }
        .img-remove-btn { position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; border-radius: 50%; background: rgba(0,0,0,0.5); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.18s; }
        .img-remove-btn:hover { background: rgba(194,24,91,0.8); }

        /* Tip / error boxes */
        .tip-box {
          margin: 0 32px 24px;
          padding: 13px 16px; border-radius: 13px;
          background: rgba(240,98,146,0.06); border: 1px solid rgba(240,98,146,0.18);
          display: flex; gap: 10px; align-items: flex-start;
        }
        .tip-box-icon { color: #f06292; flex-shrink: 0; margin-top: 2px; }
        .tip-box-text { font-size: 13px; color: #7a5a6a; line-height: 1.6; }
        .tip-box-text strong { color: #c2185b; font-weight: 600; }

        /* Card footer */
        .card-footer { padding: 18px 32px 26px; display: flex; gap: 12px; justify-content: flex-end; border-top: 1px solid #f5e6ec; flex-wrap: wrap; }

        /* Buttons */
        .btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 26px; border-radius: 14px; border: none; background: linear-gradient(135deg, #f06292, #c2185b); color: #fff; font-family: 'Mitr', sans-serif; font-size: 14.5px; font-weight: 500; cursor: pointer; box-shadow: 0 6px 20px rgba(194,24,91,0.4); transition: transform 0.18s, box-shadow 0.18s; white-space: nowrap; }
        .btn-primary:hover    { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(194,24,91,0.55); }
        .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
        .btn-ghost-sm { display: inline-flex; align-items: center; gap: 6px; padding: 13px 20px; border-radius: 14px; border: 1.5px solid #f5c6d8; background: transparent; font-family: 'Mitr', sans-serif; font-size: 13.5px; color: #c2185b; cursor: pointer; transition: background 0.18s; white-space: nowrap; }
        .btn-ghost-sm:hover { background: rgba(194,24,91,0.06); }

        /* Symptom form */
        .symptom-form { padding: 0 32px 8px; display: grid; grid-template-columns: 1fr; gap: 26px; align-items: start; }
        .sf-full { grid-column: 1 / -1; }
        .sf-label { display: flex; align-items: center; gap: 8px; font-family: 'Mitr', sans-serif; font-size: 14px; font-weight: 600; color: #1a0a14; margin-bottom: 10px; }
        .sf-label svg { color: #c2185b; }
        /* กรอบโฟกัสเมื่อใช้คีย์บอร์ด (Tab / ลูกศร) เลือกคำตอบ */
        .opt-label { position: relative; }
        .opt-label:has(input:focus-visible) { outline: 3px solid rgba(240,98,146,0.5); outline-offset: 2px; }

        /* Status badges */
        .ai-loading-badge, .ai-result-badge { display: inline-flex; align-items: center; gap: 7px; padding: 7px 16px; border-radius: 999px; background: rgba(194,24,91,0.08); border: 1px solid rgba(194,24,91,0.2); font-family: 'Mitr', sans-serif; font-size: 12.5px; color: #c2185b; margin: 0 32px 18px; flex-wrap: wrap; }

        /* Result */
        .result-risk-banner { margin: 24px 32px; border-radius: 18px; padding: 22px 24px; display: flex; align-items: center; gap: 20px; border: 1.5px solid; border-left-width: 7px; flex-wrap: wrap; }
        .risk-icon { width: 68px; height: 68px; border-radius: 22px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 32px; box-shadow: inset 0 -5px 0 rgba(0,0,0,0.12), 0 8px 18px rgba(0,0,0,0.12); }
        .risk-info { flex: 1; min-width: 200px; }
        .risk-label-tag { display: inline-flex; align-items: center; padding: 3px 11px; border-radius: 999px; border: 1.5px solid; background: #fff; font-family: 'Mitr', sans-serif; font-size: 11.5px; font-weight: 500; margin-bottom: 6px; }
        .risk-title { font-family: 'Mitr', sans-serif; font-size: 22px; font-weight: 600; margin-bottom: 4px; }
        .risk-meaning { font-size: 13.5px; color: #3a2030; line-height: 1.6; margin-bottom: 4px; }
        .risk-desc  { font-size: 13px; color: #7a5a6a; line-height: 1.6; }
        .result-legend { margin: 22px 32px 6px; }

        .result-detail { margin: 0 32px 20px; background: #faf7f5; border-radius: 15px; border: 1px solid #f5e6ec; overflow: hidden; display: grid; grid-template-columns: 1fr; }
        .rd-row { display: flex; align-items: flex-start; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #f5e6ec; }
        .rd-row:last-child { border-bottom: none; }
        .rd-icon  { width: 32px; height: 32px; border-radius: 10px; background: linear-gradient(135deg, #fce4ec, #f8bbd0); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .rd-label { font-size: 11.5px; color: #9e7a8a; margin-bottom: 3px; }
        .rd-value { font-family: 'Mitr', sans-serif; font-size: 14px; font-weight: 500; color: #1a0a14; }

        .suggestions-list { margin: 0 32px 24px; display: flex; flex-direction: column; gap: 10px; }
        .suggestion-item { display: flex; gap: 12px; padding: 14px 16px; border-radius: 13px; background: #faf7f5; border: 1px solid #f5e6ec; align-items: flex-start; }
        .suggestion-text { font-size: 13.5px; color: #4a2a3a; line-height: 1.6; }

        .disclaimer-box { margin: 0 32px 24px; padding: 13px 16px; border-radius: 12px; background: rgba(240,98,146,0.05); border: 1px solid rgba(240,98,146,0.15); display: flex; gap: 9px; align-items: flex-start; font-size: 12px; color: #9e7a8a; line-height: 1.6; }
        .result-actions { margin: 0 32px 28px; display: flex; gap: 12px; flex-wrap: wrap; }
        .btn-primary-full { flex: 1; min-width: 160px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 14px 14px; border-radius: 14px; border: none; background: linear-gradient(135deg, #f06292, #c2185b); font-family: 'Mitr', sans-serif; font-size: 13.5px; color: #fff; cursor: pointer; font-weight: 500; box-shadow: 0 6px 20px rgba(194,24,91,0.35); transition: transform 0.18s, box-shadow 0.18s; text-decoration: none; }
        .btn-primary-full:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(194,24,91,0.5); }

        /* Trust strip */
        .trust-strip { max-width: var(--page-max); margin: 0 auto 56px; padding: 0 var(--page-pad); display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .trust-item { background: #fff; border-radius: 16px; border: 1px solid #f5e6ec; padding: 18px 16px; display: flex; gap: 12px; align-items: center; }
        .trust-icon  { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #fce4ec, #f8bbd0); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .trust-label { font-family: 'Mitr', sans-serif; font-size: 13px; color: #1a0a14; line-height: 1.4; }
        .trust-sub   { font-size: 11px; color: #9e7a8a; }

        /* Animations */
        @keyframes analyzePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(240,98,146,0.3); }
          50%       { transform: scale(1.05); box-shadow: 0 0 0 14px rgba(240,98,146,0); }
        }
        @keyframes spin     { to { transform: rotate(360deg); } }
        @keyframes fadeUp   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .fade-up { animation: fadeUp 0.5s ease forwards; }

        /* ── Desktop: wider two-column layouts ── */
        @media (min-width: 769px) {
          .result-detail { grid-template-columns: 1fr 1fr; }
          /* จำนวนแถวคู่: แถวคู่สุดท้ายไม่มีเส้นล่าง / จำนวนคี่: แถวสุดท้ายเต็มความกว้าง */
          .rd-row:nth-last-child(2):nth-child(odd) { border-bottom: none; }
          .rd-row:last-child:nth-child(odd) { grid-column: 1 / -1; }
          .upload-zone { min-height: 280px; }
        }

        /* ── Mobile overrides ── */
        @media (max-width: 480px) {
          .analyze-header { padding: 24px 16px 52px; }
          .ah-sub { font-size: 12.5px; }

          .step-bar { padding: 0 12px; }
          /* จอเล็ก: วางชื่อขั้นตอนไว้ใต้วงกลม เพื่อให้มีที่แสดงชื่อเต็ม */
          .step-track { padding: 12px 10px; gap: 0; align-items: flex-start; }
          .step-node { flex: 0 0 auto; flex-direction: column; gap: 6px; text-align: center; }
          .step-label-sub { display: none; }
          .step-connector { flex: 1 1 8px; width: auto; min-width: 8px; margin: 12px 2px 0; }
          .step-circle { width: 26px; height: 26px; font-size: 11px; }
          .step-label-main { font-size: 11px; }

          .analyze-main { padding: 0 12px; margin: 20px auto 36px; }
          .main-card { border-radius: 16px; }

          .card-section-title { padding: 18px 16px 0; }
          .upload-zone { margin: 14px 16px; min-height: 180px; padding: 20px 12px; }
          .upload-zone-icon { width: 48px; height: 48px; }
          .img-preview { margin: 14px 16px; }
          .tip-box { margin-left: 16px; margin-right: 16px; }
          .card-footer { padding: 14px 16px 18px; flex-direction: column; }
          .btn-primary, .btn-ghost-sm { width: 100%; }

          .symptom-form { padding: 0 16px 8px; gap: 20px; }
          .ai-loading-badge, .ai-result-badge { margin: 0 16px 14px; font-size: 11.5px; }

          .result-risk-banner { margin: 14px 16px; padding: 16px; gap: 12px; }
          .risk-icon { width: 54px; height: 54px; border-radius: 18px; font-size: 26px; }
          .result-legend { margin: 18px 16px 4px; }
          .result-detail { margin: 0 16px 14px; }
          .suggestions-list { margin: 0 16px 16px; }
          .disclaimer-box { margin: 0 16px 16px; }
          .result-actions { margin: 0 16px 20px; flex-direction: column; }
          .btn-primary-full { width: 100%; min-width: unset; }

          .trust-strip { grid-template-columns: 1fr; padding: 0 12px; gap: 8px; }
        }

        /* ── Tablet ── */
        @media (min-width: 481px) and (max-width: 768px) {
          .analyze-header { padding: 32px 24px 56px; }
          .step-bar { padding: 0 16px; }
          .step-track { align-items: flex-start; }
          .step-node { flex: 0 0 auto; flex-direction: column; gap: 6px; text-align: center; }
          .step-connector { flex: 1 1 8px; width: auto; min-width: 8px; margin: 15px 4px 0; }
          .analyze-main { padding: 0 16px; }
          .trust-strip { grid-template-columns: 1fr 1fr; padding: 0 16px; }
          .step-label-sub { display: none; }
          .result-actions { flex-wrap: nowrap; }
        }
      `}</style>

      <div className="analyze-root">
        <Navbar />

        {/* ── Header ── */}
        <div className="analyze-header">
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <div className="ah-circle-1" /><div className="ah-circle-2" /><div className="ah-dots" />
          </div>
          <div className={`ah-content ${mounted ? 'visible' : ''}`}>
            <div className="ah-badge"><Sparkles size={11} /> วิเคราะห์ด้วย AI</div>
            <h1 className="ah-title">วิเคราะห์<span>ลิ่มเลือด</span>ประจำเดือน</h1>
            <p className="ah-sub">อัปโหลดภาพถ่าย ระบุอาการ แล้วรับผลวิเคราะห์พร้อมคำแนะนำเฉพาะบุคคล</p>
          </div>
          <div className="ah-arc" />
        </div>

        {/* ── Step bar ── */}
        <div className="step-bar">
          <div className="step-track">
            {([
              { key: 'upload',    num: 1, main: 'อัปโหลดภาพ', sub: 'เลือกไฟล์' },
              { key: 'symptoms',  num: 2, main: 'ระบุอาการ',   sub: 'กรอกข้อมูล' },
              { key: 'analyzing', num: 3, main: 'วิเคราะห์',   sub: 'AI ประมวลผล' },
              { key: 'result',    num: 4, main: 'ผลลัพธ์',     sub: 'ดูรายงาน' },
            ] as const).map((s, i, arr) => {
              const order: Step[] = ['upload', 'symptoms', 'analyzing', 'result']
              const curIdx = order.indexOf(step)
              const state  = i < curIdx ? 'done' : i === curIdx ? 'active' : 'idle'
              return (
                <Fragment key={s.key}>
                  <div className="step-node">
                    <div className={`step-circle ${state}`}>
                      {state === 'done' ? <CheckCircle2 size={13} /> : s.num}
                    </div>
                    <div className="step-label">
                      <div className="step-label-main">{s.main}</div>
                      <div className="step-label-sub">{s.sub}</div>
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={`step-connector ${i < curIdx ? 'done' : ''}`} />
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>

        {/* ── Main card ── */}
        <div className="analyze-main">
          <div className="main-card" style={{ marginTop: 24 }}>

            {/* ══ STEP 1: Upload ══ */}
            {step === 'upload' && (
              <div className="fade-up">
                <div className="card-section-title">
                  <div className="cst-icon"><ImageIcon size={18} color="#c2185b" /></div>
                  <div>
                    <div className="cst-text">อัปโหลดภาพประจำเดือน</div>
                    <div className="cst-sub">รองรับ JPG, JPEG, PNG ขนาดไม่เกิน 10MB</div>
                  </div>
                </div>

                {!image ? (
                  <div
                    className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                    onClick={handleChooseImage}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                  >
                    <div className="upload-zone-icon"><Upload size={26} color="#c2185b" /></div>
                    <div className="upload-zone-title">ลากไฟล์มาวางหรือคลิกเพื่อเลือก</div>
                    <div className="upload-zone-sub">รูปที่แสดงถึงเกี่ยวข้องประจำเดือน</div>
                    <div className="upload-chip"><ImageIcon size={13} /> เลือกภาพ</div>
                    <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                  </div>
                ) : (
                  <div className="img-preview">
                    <img src={image} alt="preview" />
                    <div className="img-preview-overlay">
                      <div className="img-preview-tag">
                        <CheckCircle2 size={12} color="#c2185b" /> ภาพพร้อมวิเคราะห์
                      </div>
                    </div>
                    <button className="img-remove-btn" onClick={() => { setImage(null); setAiImage(null) }}>
                      <X size={13} color="#fff" />
                    </button>
                  </div>
                )}

                <div className="tip-box">
                  <Info size={14} className="tip-box-icon" />
                  <div className="tip-box-text">
                    <strong>เคล็ดลับ:</strong> ถ่ายภาพในที่มีแสงสว่างเพียงพอ วางบนพื้นสีขาว และถ่ายให้ชัดเจนเพื่อผลวิเคราะห์ที่แม่นยำที่สุด
                  </div>
                </div>

                <div className="card-footer">
                  <button className="btn-primary" disabled={!image || imageLoading} onClick={goToSymptoms}>
                    {imageLoading
                      ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> กำลังตรวจสอบ...</>
                      : <>ถัดไป: ประมวลผลรูปภาพ <ChevronRight size={14} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* ══ STEP 2: Symptoms ══ */}
            {step === 'symptoms' && (
              <div className="fade-up">
                <div className="card-section-title">
                  <div className="cst-icon"><Activity size={18} color="#c2185b" /></div>
                  <div>
                    <div className="cst-text">ระบุอาการ</div>
                    <div className="cst-sub">กรอกข้อมูลให้ครบเพื่อผลที่แม่นยำ</div>
                  </div>
                </div>

                {/* ภาพที่ AI วิเคราะห์ (ภาพที่วาดกรอบผล AI — ถ้ายังไม่มีใช้ภาพจากเครื่อง) */}
                {(aiImage ?? image) && (
                  <div className="img-preview img-preview--symptoms">
                    <img src={(aiImage ?? image)!} alt="ภาพที่ AI วิเคราะห์" />
                    <div className="img-preview-overlay">
                      <div className="img-preview-tag">
                        <ImageIcon size={12} color="#c2185b" /> ภาพที่ AI วิเคราะห์
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ height: 14 }} />

                {!imageResult && (
                  <div className="ai-loading-badge">
                    <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                    กำลังวิเคราะห์ภาพ...
                  </div>
                )}
                {imageResult && (
                  <div className="ai-result-badge">
                    <CheckCircle2 size={13} />
                    ผลภาพ: <strong>{imageResult.detect_label}</strong>
                    &nbsp;(ความมั่นใจ AI {confidenceText(imageResult)})
                  </div>
                )}

                <div className="symptom-form">
                  <div>
                    <div className="sf-label"><Activity size={14} /> ปริมาณประจำเดือน</div>
                    <RadioGroup name="flow" options={FLOW_OPTIONS} value={form.flow}
                      onChange={v => setForm(f => ({ ...f, flow: v }))} />
                  </div>
                  <div>
                    <div className="sf-label"><Clock size={14} /> ระยะเวลาที่มีประจำเดือน</div>
                    <RadioGroup name="duration" options={DURATION_OPTIONS} value={form.duration}
                      onChange={v => setForm(f => ({ ...f, duration: v }))} />
                  </div>
                  <div>
                    <div className="sf-label"><Clock size={14} /> ความถี่รอบเดือน</div>
                    <RadioGroup name="cycle" options={CYCLE_OPTIONS} value={form.cycle}
                      onChange={v => setForm(f => ({ ...f, cycle: v }))} />
                  </div>
                  <div>
                    <div className="sf-label"><Info size={14} /> ลักษณะเลือดที่ออกทางช่องคลอด</div>
                    <RadioGroup name="bleeding" options={BLEEDING_OPTIONS} value={form.bleeding}
                      onChange={v => setForm(f => resetPregnancyIfHidden({ ...f, bleeding: v }))} />
                  </div>
                  <div>
                    <div className="sf-label"><Activity size={14} /> อาการปวดประจำเดือน</div>
                    <RadioGroup name="pain" options={PAIN_OPTIONS} value={form.pain_level}
                      onChange={v => setForm(f => ({ ...f, pain_level: v }))} />
                  </div>
                  <div>
                    <div className="sf-label"><Activity size={14} /> อาการปวดท้องน้อย</div>
                    <RadioGroup name="pelvic" options={PELVIC_PAIN_OPTIONS} value={form.pelvic_pain}
                      onChange={v => setForm(f => ({ ...f, pelvic_pain: v }))} />
                  </div>
                  {/* อาการอื่น ๆ: เต็มความกว้าง ตัวเลือกเรียงเป็นตาราง */}
                  <div className="sf-full">
                    <div className="sf-label"><Sparkles size={14} /> อาการอื่น ๆ (ตอบได้หลายข้อ)</div>
                    <CheckboxGroup options={ASSOCIATED_SYMPTOM_OPTIONS} values={form.symptoms}
                      onChange={v => setForm(f => ({ ...f, symptoms: v }))} />
                  </div>
                  <div>
                    <div className="sf-label"><Shield size={14} /> การมีเพศสัมพันธ์ล่าสุด</div>
                    <RadioGroup name="sex" options={SEX_HISTORY_OPTIONS} value={form.sex_history}
                      onChange={v => setForm(f => resetPregnancyIfHidden({ ...f, sex_history: v }))} />
                  </div>
                  {/* แสดงเมื่อข้อ 8 ไม่ใช่ "ไม่เคยมีเพศสัมพันธ์" หรือข้อ 4 เลือก "เลือดออกหลังมีเพศสัมพันธ์" */}
                  {needsPregnancyQuestion(form) && (
                    <div>
                      <div className="sf-label"><Baby size={14} /> การตรวจการตั้งครรภ์</div>
                      <RadioGroup name="preg"
                        options={PREGNANCY_OPTIONS}
                        value={form.is_pregnant}
                        onChange={v => setForm(f => ({ ...f, is_pregnant: v }))} />
                    </div>
                  )}
                  {/* แสดงเฉพาะเมื่อ AI พบลิ่มเลือดในภาพ */}
                  {imageResult?.ai_result === 'clot' && <div>
                    <div className="sf-label"><Ruler size={14} /> ขนาดของลิ่มเลือด</div>
                    <RadioGroup name="size" options={SIZE_OPTIONS} value={form.size}
                      onChange={v => setForm(f => ({ ...f, size: v }))} />
                  </div>}
                </div>

                <div style={{ height: 12 }} />
                <div className="tip-box" style={{ marginBottom: 0 }}>
                  <AlertCircle size={14} className="tip-box-icon" />
                  <div className="tip-box-text">ข้อมูลทุกอย่างจะถูกใช้เพื่อการวิเคราะห์เท่านั้น ไม่มีการแชร์ข้อมูลส่วนตัว</div>
                </div>

                <div className="card-footer">
                  <button className="btn-ghost-sm" onClick={() => setStep('upload')}>
                    ← ย้อนกลับ
                  </button>
                  <button className="btn-primary" disabled={!formValid} onClick={runAnalysis}>
                    <Zap size={14} /> เริ่มวิเคราะห์
                  </button>
                </div>
              </div>
            )}

            {/* ══ STEP 3: Analyzing ══ */}
            {step === 'analyzing' && <AnalyzingScreen />}

            {/* ══ STEP 4: Result ══ */}
            {step === 'result' && riskResult && (
              <div className="fade-up">
                <div className="card-section-title">
                  <div className="cst-icon"><FlaskConical size={18} color="#c2185b" /></div>
                  <div>
                    <div className="cst-text">ผลการวิเคราะห์</div>
                  </div>
                </div>

                {/* Risk banner */}
                <div className="result-risk-banner" style={{ background: rc.tint, borderColor: rc.solid }}>
                  <div className="risk-icon" style={{ background: rc.solid }}>{rc.icon}</div>
                  <div className="risk-info">
                    <div className="risk-label-tag" style={{ color: rc.ink, borderColor: rc.solid }}>ระดับความเสี่ยง</div>
                    <div className="risk-title" style={{ color: rc.ink }}>{riskResult.Risk_Level}</div>
                    {rc.meaning && <div className="risk-meaning">{rc.meaning}</div>}
                    <div className="risk-desc">{riskResult.Potential_Disease}</div>
                  </div>
                </div>

                {/* Details */}
                <div style={{ padding: '12px 32px 10px' }}>
                  <div style={{ fontFamily: "'Mitr',sans-serif", fontSize: 14, fontWeight: 600, color: '#1a0a14' }}>รายละเอียด</div>
                </div>
                <div className="result-detail">
                  <div className="rd-row">
                    <div className="rd-icon">🩸</div>
                    {/* Detect2 = ผลภาพที่ละเอียดกว่า (เช่น รวมขนาดลิ่มเลือด) — ไม่มีจึงใช้ Detect1 */}
                    <div><div className="rd-label">ผลการวิเคราะห์ภาพ (AI)</div><div className="rd-value">{riskResult.Detect2 || riskResult.Detect1}</div></div>
                  </div>
                  {imageResult && (
                    <div className="rd-row">
                      <div className="rd-icon">📊</div>
                      <div><div className="rd-label">ความมั่นใจของ AI</div><div className="rd-value">{confidenceText(imageResult)}</div></div>
                    </div>
                  )}
                  <div className="rd-row">
                    <div className="rd-icon">🎯</div>
                    <div><div className="rd-label">โรคที่อาจเกี่ยวข้อง</div><div className="rd-value">{riskResult.Potential_Disease}</div></div>
                  </div>
                </div>

                {/* Risk legend */}
                <div className="result-legend">
                  <RiskLegend current={riskResult.Risk_Level} />
                </div>

                {/* Recommendation */}
                <div style={{ padding: '12px 32px 10px' }}>
                  <div style={{ fontFamily: "'Mitr',sans-serif", fontSize: 14, fontWeight: 600, color: '#1a0a14' }}>คำแนะนำ</div>
                </div>
                <div className="suggestions-list">
                  {uniqueSuggestions(riskResult.Recommendation).map((s, i) => (
                    <div key={i} className="suggestion-item">
                      <div className="suggestion-text">{s}</div>
                    </div>
                  ))}
                </div>

                <div className="disclaimer-box">
                  <Shield size={13} color="#f06292" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>ผลการวิเคราะห์นี้เป็นเพียงการประเมินเบื้องต้น ไม่ใช่การวินิจฉัยทางการแพทย์ กรุณาปรึกษาแพทย์เพื่อการวินิจฉัยที่ถูกต้อง</span>
                </div>

                <div className="result-actions">
                  <button className="btn-primary-full" onClick={resetAll}>วิเคราะห์ใหม่</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Trust badges ── */}
        {(step === 'upload' || step === 'symptoms') && (
          <div className="trust-strip">
            {[
              { icon: <Shield size={17} color="#c2185b" />,   label: 'ปลอดภัย', sub: 'ข้อมูลไม่ถูกแชร์' },
              { icon: <Zap size={17} color="#c2185b" />,      label: 'รวดเร็ว',  sub: 'รู้ผลภายใน 1 นาที' },
              { icon: <Activity size={17} color="#c2185b" />, label: 'แม่นยำ',  sub: 'วิเคราะห์ด้วย AI' },
            ].map((t, i) => (
              <div key={i} className="trust-item">
                <div className="trust-icon">{t.icon}</div>
                <div>
                  <div className="trust-label">{t.label}</div>
                  <div className="trust-sub">{t.sub}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showPhotoAccessNotice && (
          <div className="photo-access-overlay" onClick={() => setShowPhotoAccessNotice(false)}>
            <div
              className="photo-access-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="photo-access-title"
              onClick={e => e.stopPropagation()}
            >
              <div className="photo-access-icon"><ImageIcon size={26} color="#c2185b" strokeWidth={1.5} /></div>
              <h2 id="photo-access-title" className="photo-access-title">ตรวจสอบสิทธิ์การเข้าถึงรูปภาพ</h2>
              <p className="photo-access-message">
                หากอุปกรณ์หรือเบราว์เซอร์แจ้งขอสิทธิ์เข้าถึงรูปภาพ โปรดเลือกอนุญาต หากเลือกภาพไม่ได้ ให้ตรวจสอบสิทธิ์การเข้าถึงอัลบั้มภาพในการตั้งค่าอุปกรณ์หรือเบราว์เซอร์
              </p>
              <div className="photo-access-actions">
                <button className="photo-access-cancel" onClick={() => setShowPhotoAccessNotice(false)}>ภายหลัง</button>
                <button
                  className="btn-primary"
                  onClick={() => { setShowPhotoAccessNotice(false); openImagePicker() }}
                >
                  เข้าใจแล้ว เลือกภาพ
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  )
}