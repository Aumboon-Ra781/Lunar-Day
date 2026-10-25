'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  User, Settings, Droplets, Shield, FileText,
  LogOut, Trash2, ChevronRight, ArrowLeft,
  Camera, Eye, EyeOff, Sparkles, Activity,
  Calendar, Edit3, X, Check, AlertTriangle, ImageIcon
} from 'lucide-react'
import Navbar from '../components/Navbar'
import { MIN_AGE, ageFrom, latestAllowedBirthDate, parseYmd } from '../../lib/birthDate'
import { parseServerDate } from '../../lib/serverDate'
import { useToast } from '../../components/Toast'
import { PRIVACY_TEXT, TERMS_INTRO, TERMS_TEXT, type PolicySection } from '../../lib/policyText'
import PolicyBody from '../../components/PolicyBody'
import MiniSelect from '../../components/MiniSelect'
import { USERNAME_MAX, usernameError } from '../../lib/authRules'
import { avatarUrlFromFile, getCachedAvatar, getMemoryAvatar, setCachedAvatar } from '../../lib/avatarCache'
import { clearProfileCache, getCachedHistory, getCachedProfile, setCachedHistory, setCachedProfile } from '../../lib/profileCache'
import { getRiskLevel } from '../../lib/riskLevels'
import type { HistoryItem, Profile } from '../../lib/types'
import RiskLegend from '../../components/RiskLegend'
import { MSG_NETWORK_ERROR, MSG_SERVER_ERROR, isAuthError, readJson, responseMessage } from '../../lib/postJson'
import { apiBase, backendUrl } from '../../lib/apiBase'
import { clickable } from '../../lib/a11y'
import { NAV_RESELECT_EVENT } from '../../lib/navEvents'

// ============================================================
// TYPES
// ============================================================
type View = 'profile' | 'editProfile' | 'history' | 'historyDetail' | 'privacy' | 'terms'

type EditForm = {
  name: string
  lastname: string
  username: string
  birthday: string
  avatarFile: File | null
}


// ============================================================
// HELPERS
// ============================================================
// backend บันทึกภาพที่วาดกรอบผล AI ไว้เป็น res_<ชื่อไฟล์เดิม> ในโฟลเดอร์เดียวกัน
// Image_Path ใน DB อาจเป็น path ("uploads/x.jpg") หรือ URL เต็ม ("http://host:5000/uploads/x.jpg") → แปลงด้วย backendUrl()
function resultImagePath(path: string) {
  return path.replace(/([^/]+)$/, 'res_$1')
}

// สิทธิ์เข้าถึงอัลบั้มภาพ (มือถือ): ถามผู้ใช้ก่อนเปิดตัวเลือกรูป แล้วจำคำตอบ "อนุญาต" ไว้
const PHOTO_PERMISSION_KEY = 'photo_permission'
const MSG_PHOTO_PERMISSION = 'ไม่สามารถเข้าถึงรูปภาพได้ กรุณาเปิดสิทธิ์การเข้าถึงอัลบั้มภาพในการตั้งค่าของอุปกรณ์'
const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

function buddhistDate(iso: string) {
  if (!iso) return '-'
  const [y, m, d] = iso.split('-')
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${parseInt(y)+543}`
}

// สีตามระดับความเสี่ยง (ชุดเดียวกับหน้าผลการวิเคราะห์ — lib/riskLevels)
function riskStyle(level: string | null | undefined) {
  const r = getRiskLevel(level)
  return r
    ? { bg: r.tint, color: r.ink, dot: r.solid }
    : { bg: '#f1f5f9', color: '#475569', dot: '#94a3b8' }   // เช่น "ไม่พบโรค"
}

const HISTORY_PER_PAGE = 15

// ============================================================
// THAI DATE PICKER
// ============================================================
const THAI_MONTHS_FULL = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
]
const DOW_SHORT = ['อา','จ','อ','พ','พฤ','ศ','ส']

function ThaiDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const today = new Date()
  const [open, setOpen] = useState(false)
  // เลือกได้เฉพาะวันเกิดที่ทำให้อายุครบ 13 ปีขึ้นไป
  const maxBirth = latestAllowedBirthDate()

  const parsed = parseYmd(value)
  const initYear  = parsed ? parsed.getFullYear()  : maxBirth.getFullYear()
  const initMonth = parsed ? parsed.getMonth()      : maxBirth.getMonth()

  const [viewYear,  setViewYear]  = useState(initYear)
  const [viewMonth, setViewMonth] = useState(initMonth)

  const maxYear = maxBirth.getFullYear()
  const years = Array.from({ length: 101 }, (_, i) => maxYear - 100 + i)
  const isTooYoung = (d: number) => new Date(viewYear, viewMonth, d) > maxBirth

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDow    = new Date(viewYear, viewMonth, 1).getDay()

  const selectedDay = parsed && parsed.getFullYear() === viewYear && parsed.getMonth() === viewMonth
    ? parsed.getDate() : null

  const selectDay = (d: number) => {
    if (isTooYoung(d)) return
    const ce = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    onChange(ce)
    setOpen(false)
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const displayLabel = parsed
    ? `${parsed.getDate()} ${THAI_MONTHS_FULL[parsed.getMonth()]} ${parsed.getFullYear() + 543}`
    : 'วัน/เดือน/ปี (พ.ศ.)'

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '13px 16px', borderRadius: 12,
          border: `2px solid ${open ? '#f06292' : '#fce7f3'}`,
          fontSize: 14, outline: 'none', fontFamily: "'Sarabun', sans-serif",
          background: '#fff', color: parsed ? '#1a0a14' : '#9e7a8a',
          cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.18s',
        }}
      >
        {displayLabel}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0,
          zIndex: 100, background: '#fff',
          border: '1.5px solid #f5e6ec', borderRadius: 12, padding: 7,
          boxShadow: '0 12px 40px rgba(194,24,91,0.15)',
          width: 180,
        }}>
          {/* Month / Year selects */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <MiniSelect
              ariaLabel="เลือกเดือน" value={viewMonth} onChange={setViewMonth}
              options={THAI_MONTHS_FULL.map((m, i) => ({ value: i, label: m }))}
            />
            <MiniSelect
              ariaLabel="เลือกปี (พ.ศ.)" value={viewYear} onChange={setViewYear}
              options={years.map(y => ({ value: y, label: String(y + 543) }))}
            />
          </div>

          {/* Header nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button type="button" onClick={prevMonth} style={{
              width: 22, height: 22, borderRadius: 6,
              border: '1px solid #fce7f3',
              background: '#fff', cursor: 'pointer', color: '#c2185b', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>‹</button>
            <span style={{ fontFamily: "'Mitr', sans-serif", fontSize: 10, fontWeight: 600, color: '#c2185b' }}>
              {THAI_MONTHS_FULL[viewMonth]} {viewYear + 543}
            </span>
            <button type="button" onClick={nextMonth} style={{
              width: 22, height: 22, borderRadius: 6,
              border: '1px solid #fce7f3',
              background: '#fff', cursor: 'pointer', color: '#c2185b', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>›</button>
          </div>

          {/* Day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {DOW_SHORT.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: 8, color: '#c2185b',
                padding: '1px 0', fontFamily: "'Mitr', sans-serif",
              }}>{d}</div>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
              const isSelected = selectedDay === d
              const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()
              const disabled = isTooYoung(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => selectDay(d)}
                  disabled={disabled}
                  style={{
                    aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
                    opacity: disabled ? 0.3 : 1,
                    fontFamily: "'Sarabun', sans-serif",
                    background: isSelected ? 'linear-gradient(135deg, #f06292, #c2185b)' : 'transparent',
                    color: isSelected ? '#fff' : isToday ? '#c2185b' : '#3a2030',
                    fontWeight: isSelected || isToday ? 700 : 400,
                  }}
                >{d}</button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// SUB-PAGE HEADER (ใช้ร่วมกันทุกหน้าย่อย)
// ============================================================
function SubHeader({ title, subtitle, icon, onBack }: {
  title: string; subtitle?: string; icon?: React.ReactNode; onBack: () => void
}) {
  return (
    <div className="pf-subhero">
      <div style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '28px 28px', position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: -80, right: -40, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(240,98,146,0.14), transparent 60%)' }} />
      <div className="pf-container" style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff',
        }}><ArrowLeft size={18} /></button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {icon && (
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: 'rgba(240,98,146,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f8bbd0',
            }}>{icon}</div>
          )}
          <div style={{ minWidth: 0 }}>
            <h1 className="pf-subhero-title">{title}</h1>
            {subtitle && <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{subtitle}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PROFILE VIEW
// ============================================================
function ProfileView({
  profile, avatarUrl, history,
  onEditProfile, onViewHistory, onViewPrivacy, onViewTerms, onLogout, onDeleteAccount,
}: {
  profile: Profile | null; avatarUrl: string | null; history: HistoryItem[]
  onEditProfile: () => void; onViewHistory: () => void
  onViewPrivacy: () => void; onViewTerms: () => void
  onLogout: () => void; onDeleteAccount: () => void
}) {
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#9e7a8a', letterSpacing: '1px',
    textTransform: 'uppercase', marginBottom: 10, padding: '0 4px',
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* HERO */}
      <div className="pf-hero">
        <div style={{ position: 'absolute', top: -60, right: -60, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(240,98,146,0.18), transparent 60%)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: '30%', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(206,147,216,0.12), transparent 60%)' }} />
        <div style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '28px 28px', position: 'absolute', inset: 0 }} />
        <div className="pf-container" style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 999,
              background: 'rgba(240,98,146,0.2)', border: '1px solid rgba(240,98,146,0.35)',
              fontSize: 11, color: '#f8bbd0', fontFamily: "'Mitr', sans-serif", letterSpacing: '0.5px',
            }}>
              <Sparkles size={10} /> โปรไฟล์ของฉัน
            </div>
          </div>
          <h1 className="pf-hero-title">
            สวัสดี, {profile?.Name} 👋
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>@{profile?.Username}</p>
        </div>
      </div>

      {/* BODY: การ์ดโปรไฟล์ซ้าย + เมนูขวา */}
      <div className="pf-container pf-profile-grid">
        {/* LEFT: profile card */}
        <aside className="pf-profile-card">
          <div style={{
            width: 150, height: 150, borderRadius: '50%',
            border: '4px solid #fff', outline: '3px solid #f48fb1', overflow: 'hidden',
            background: 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(194,24,91,0.25)', flexShrink: 0,
          }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <User size={48} color="#c2185b" strokeWidth={1.5} />
            }
          </div>

          <div style={{ textAlign: 'center', width: '100%' }}>
            <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 20, fontWeight: 600, color: '#1a0a14', wordBreak: 'break-word' }}>
              {profile?.Name} {profile?.LastName}
            </p>
            <p style={{ fontSize: 13, color: '#9e7a8a', marginTop: 2 }}>@{profile?.Username}</p>
            {profile?.Birthday && (
              <p style={{ fontSize: 12.5, color: '#b09aa8', marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={12} />
                {buddhistDate(profile.Birthday)}
              </p>
            )}
          </div>

          <div style={{ width: '100%', height: 1, background: '#f5e6ec' }} />

          <div style={{ display: 'flex', gap: 10, width: '100%' }}>
            <div style={{
              flex: 1, padding: '12px 14px', borderRadius: 14,
              background: 'linear-gradient(135deg, #fff5f8, #fce4ec)', border: '1px solid #f8d7e3',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <Activity size={18} color="#c2185b" />
              <div>
                <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 18, fontWeight: 600, color: '#c2185b', lineHeight: 1.1 }}>{history.length}</p>
                <p style={{ fontSize: 11, color: '#9e7a8a' }}>รายการ</p>
              </div>
            </div>
            <button onClick={onEditProfile} style={{
              width: 56, borderRadius: 14,
              border: '1.5px solid rgba(194,24,91,0.2)', background: 'rgba(194,24,91,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#c2185b', flexShrink: 0,
            }}>
              <Edit3 size={18} />
            </button>
          </div>
        </aside>

        {/* RIGHT: menu groups */}
        <div className="pf-menu-area">
          <section className="pf-menu-section pf-menu-wide">
            <p style={sectionLabel}>บัญชีและข้อมูล</p>
            <div className="pf-menu-pair">
              <MenuItem icon={<Settings size={18} />} label="จัดการโปรไฟล์" desc="แก้ไขข้อมูลส่วนตัวและรูปภาพ" onClick={onEditProfile} />
              <MenuItem icon={<Droplets size={18} />} label="ประวัติการวิเคราะห์ลิ่มเลือด" desc={`${history.length} รายการ`} onClick={onViewHistory} badge={history.length.toString()} />
            </div>
          </section>

          <section className="pf-menu-section">
            <p style={sectionLabel}>กฎหมายและนโยบาย</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MenuItem icon={<Shield size={18} />} label="ประกาศนโยบายความเป็นส่วนตัว" desc="การใช้งานและการคุ้มครองข้อมูล" onClick={onViewPrivacy} />
              <MenuItem icon={<FileText size={18} />} label="ข้อตกลงเงื่อนไขการใช้งาน" desc="เงื่อนไขการใช้บริการ Luna day" onClick={onViewTerms} />
            </div>
          </section>

          <section className="pf-menu-section">
            <p style={sectionLabel}>บัญชี</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MenuItem icon={<LogOut size={18} />} label="ออกจากระบบ" onClick={onLogout} />
              <MenuItem icon={<Trash2 size={18} />} label="ลบบัญชีผู้ใช้" danger onClick={onDeleteAccount} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// EDIT PROFILE VIEW
// ============================================================
function EditProfileView({
  avatarUrl, editForm, setEditForm, previewUrl, avatarInputRef,
  handleAvatarChange, onPickAvatar, onPickCancel, handleSaveProfile, onBack,
}: {
  avatarUrl: string | null; editForm: EditForm
  setEditForm: React.Dispatch<React.SetStateAction<EditForm>>
  previewUrl: string | null
  avatarInputRef: React.RefObject<HTMLInputElement | null>
  handleAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPickAvatar: () => void; onPickCancel: () => void
  handleSaveProfile: () => void; onBack: () => void
}) {
  // ปิดหน้าเลือกรูปโดยไม่ได้รูป (เช่น ระบบปฏิเสธสิทธิ์อัลบั้มภาพ) → input ยิง event 'cancel'
  useEffect(() => {
    const input = avatarInputRef.current
    if (!input) return
    input.addEventListener('cancel', onPickCancel)
    return () => input.removeEventListener('cancel', onPickCancel)
  }, [avatarInputRef, onPickCancel])

  return (
    <div style={{ paddingBottom: 60 }}>
      <SubHeader title="จัดการโปรไฟล์" subtitle="แก้ไขข้อมูลส่วนตัวของคุณ" onBack={onBack} />

      <div className="pf-container pf-body pf-edit-grid">
        {/* Avatar */}
        <div className="pf-card" style={{
          padding: '36px 28px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{ position: 'relative' }}>
            <div style={{
              width: 140, height: 140, borderRadius: '50%',
              border: '3px solid #f48fb1', overflow: 'hidden',
              background: 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(194,24,91,0.2)',
            }}>
              {previewUrl
                ? <img src={previewUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : avatarUrl
                  ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <User size={52} color="#c2185b" strokeWidth={1.5} />
              }
            </div>
            <button type="button" aria-label="เปลี่ยนรูปโปรไฟล์" onClick={onPickAvatar} style={{
              position: 'absolute', bottom: 4, right: 4,
              width: 38, height: 38, borderRadius: '50%',
              background: 'linear-gradient(135deg, #f06292, #c2185b)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(194,24,91,0.4)',
              border: '3px solid #fff', padding: 0,
            }}>
              <Camera size={15} color="#fff" />
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
          </div>
          <p style={{ fontSize: 13, color: '#c2185b', fontWeight: 500 }}>แตะเพื่อเปลี่ยนรูปโปรไฟล์</p>
        </div>

        {/* Form + Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <div className="pf-card" style={{ padding: 'clamp(20px, 2.4vw, 32px)' }}>
            <div className="pf-form-grid">
              <FormField label="ชื่อ"       value={editForm.name}     onChange={v => setEditForm(f => ({ ...f, name: v }))}     onKeyDown={e => e.key === 'Enter' && handleSaveProfile()} />
              <FormField label="นามสกุล"   value={editForm.lastname}  onChange={v => setEditForm(f => ({ ...f, lastname: v }))} onKeyDown={e => e.key === 'Enter' && handleSaveProfile()} />
              <FormField label="ชื่อผู้ใช้" value={editForm.username}  onChange={v => setEditForm(f => ({ ...f, username: v }))} prefix="@" maxLength={USERNAME_MAX} onKeyDown={e => e.key === 'Enter' && handleSaveProfile()} />

              {/* Birthday */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9d174d', marginBottom: 6, paddingLeft: 2 }}>
                  วัน-เดือน-ปีเกิด
                </label>
                <ThaiDatePicker
                  value={editForm.birthday}
                  onChange={v => setEditForm(f => ({ ...f, birthday: v }))}
                />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={onBack} style={{
              flex: '0 1 200px', padding: '14px', borderRadius: 14,
              border: '1.5px solid rgba(194,24,91,0.25)', background: 'transparent', color: '#c2185b',
              fontFamily: "'Mitr', sans-serif", fontSize: 14, fontWeight: 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <X size={15} /> ยกเลิก
            </button>
            <button onClick={handleSaveProfile} className="btn-primary" style={{ flex: '0 1 200px', padding: '14px', justifyContent: 'center' }}>
              <Check size={15} /> บันทึก
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// HISTORY VIEW
// ============================================================
function HistoryThumb({ path }: { path?: string | null }) {
  // ภาพที่ AI วาดกรอบแล้ว → ถ้าไม่มีใช้ภาพต้นฉบับ → ถ้าไม่มีเลยแสดงไอคอน
  const [stage, setStage] = useState<0 | 1 | 2>(path ? 0 : 2)
  if (!path || stage === 2) {
    return <div className="pf-hist-thumb pf-hist-thumb-empty"><Droplets size={26} color="#f48fb1" strokeWidth={1.5} /></div>
  }
  const src = backendUrl(stage === 0 ? resultImagePath(path) : path)
  return (
    <img
      className="pf-hist-thumb" src={src} alt="ภาพที่วิเคราะห์" loading="lazy"
      onError={() => setStage(s => (s === 0 ? 1 : 2))}
    />
  )
}

function HistoryView({ history, emptyMsg, onBack, onSelectItem, onDeleteItem }: {
  history: HistoryItem[]; emptyMsg: string; onBack: () => void; onSelectItem: (item: HistoryItem) => void; onDeleteItem: (item: HistoryItem) => void
}) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE))
  const current = Math.min(page, totalPages)   // ลบจนหน้าสุดท้ายว่าง → ถอยกลับหน้าก่อน
  const items = history.slice((current - 1) * HISTORY_PER_PAGE, current * HISTORY_PER_PAGE)

  const goTo = (n: number) => {
    setPage(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      <SubHeader title="ประวัติการวิเคราะห์" subtitle={`ลิ่มเลือดทั้งหมด ${history.length} รายการ`} onBack={onBack} />

      <div className="pf-container pf-body">
        <div style={{ marginBottom: 'clamp(18px, 2vw, 26px)' }}>
          <RiskLegend />
        </div>

        {history.length === 0 ? (
          <div className="pf-card" style={{ textAlign: 'center', padding: '80px 20px', color: '#9e7a8a' }}>
            <Droplets size={56} color="#f8bbd0" strokeWidth={1} style={{ marginBottom: 16 }} />
            {/* ข้อความจาก backend (GET /history/ ตอบ status 'empty') — ระหว่างรอโหลดยังไม่แสดงข้อความ */}
            {emptyMsg && <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 16 }}>{emptyMsg}</p>}
          </div>
        ) : (
          <>
            <div className="pf-history-list">
              {items.map((item, i) => {
                const cfg = riskStyle(item.Risk_Level)
                const date = parseServerDate(item.Create_At)
                return (
                  <div key={item.AssessmentID} className="pf-history-card" {...clickable(() => onSelectItem(item))}
                    aria-label={`ดูรายละเอียด ${item.Detect2 || ''} ${item.Risk_Level || ''}`.trim()}
                    style={{ animation: `fadeUp 0.4s ease ${Math.min(i, 12) * 0.04}s forwards`, borderLeftColor: cfg.dot }}>
                    <HistoryThumb path={item.Image_Path} />

                    <div className="pf-hist-info">
                      <div className="pf-hist-field">
                        <span className="pf-hist-label">วันที่</span>
                        <span className="pf-hist-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Calendar size={12} color="#9e7a8a" />
                          {date?.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) ?? '-'}
                        </span>
                      </div>
                      <div className="pf-hist-field">
                        <span className="pf-hist-label">ความเสี่ยง</span>
                        <span>
                          <span className="pf-hist-badge" style={{ background: cfg.bg, color: cfg.color }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot }} />
                            {item.Risk_Level || '-'}
                          </span>
                        </span>
                      </div>
                      <div className="pf-hist-field">
                        <span className="pf-hist-label">ประเภท</span>
                        <span className="pf-hist-value">{item.Detect2 || '-'}</span>
                      </div>
                      <div className="pf-hist-field pf-hist-wide">
                        <span className="pf-hist-label">โรคที่เกี่ยวข้อง</span>
                        <span className="pf-hist-value pf-hist-clamp">{item.Potential_Disease || '-'}</span>
                      </div>
                    </div>

                    <div className="pf-hist-actions">
                      <button
                        className="pf-hist-trash" aria-label="ลบรายการนี้" title="ลบรายการนี้"
                        onClick={e => { e.stopPropagation(); onDeleteItem(item) }}
                      >
                        <Trash2 size={17} />
                      </button>
                      <ChevronRight size={18} color="#d6b4c4" />
                    </div>
                  </div>
                )
              })}
            </div>

            {totalPages > 1 && (
              <div className="pf-pager">
                <button className="pf-pager-btn" disabled={current === 1} onClick={() => goTo(current - 1)} aria-label="หน้าก่อนหน้า">
                  <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <button key={n} className={`pf-pager-btn${n === current ? ' active' : ''}`} onClick={() => goTo(n)}>{n}</button>
                ))}
                <button className="pf-pager-btn" disabled={current === totalPages} onClick={() => goTo(current + 1)} aria-label="หน้าถัดไป">
                  <ChevronRight size={16} />
                </button>
                <span className="pf-pager-info">
                  {(current - 1) * HISTORY_PER_PAGE + 1}–{Math.min(current * HISTORY_PER_PAGE, history.length)} จาก {history.length} รายการ
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// DOC VIEW
// ============================================================
function DocView({ title, intro, sections, icon, onBack }: {
  title: string; intro?: string; sections: PolicySection[]
  icon: React.ReactNode; onBack: () => void
}) {
  return (
    <div style={{ paddingBottom: 60 }}>
      <SubHeader title={title} icon={icon} onBack={onBack} />
      <div className="pf-container pf-body">
        {intro && (
          <div className="pf-card" style={{ padding: 'clamp(20px, 2vw, 28px)', marginBottom: 'clamp(14px, 1.6vw, 20px)' }}>
            <p style={{ fontSize: 14, color: '#5a3a4a', lineHeight: 1.8 }}>{intro}</p>
          </div>
        )}
        <div className="pf-doc-grid">
          {sections.map((s, i) => (
            <div key={i} className="pf-card" style={{ padding: 'clamp(20px, 2vw, 28px)' }}>
              <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 15, fontWeight: 600, color: '#c2185b', marginBottom: 10 }}>{s.title}</p>
              <PolicyBody paragraphs={s.paragraphs} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function ProfilePage() {
  const router = useRouter()
  const [view, setView] = useState<View>('profile')
  // กดเมนูโปรไฟล์ขณะอยู่หน้านี้ (เช่น ดูประวัติอยู่) → กลับไปหน้าโปรไฟล์หลัก
  useEffect(() => {
    const onReselect = (e: Event) => {
      if ((e as CustomEvent<string>).detail === '/home/profile') setView('profile')
    }
    window.addEventListener(NAV_RESELECT_EVENT, onReselect)
    return () => window.removeEventListener(NAV_RESELECT_EVENT, onReselect)
  }, [])
  // เริ่มจากข้อมูลที่จำไว้ (ถ้ามี) → กลับมาหน้านี้แล้วชื่อ/จำนวนประวัติไม่กะพริบ
  const [profile, setProfile] = useState<Profile | null>(getCachedProfile)
  const [history, setHistory] = useState<HistoryItem[]>(getCachedHistory)
  const [historyEmptyMsg, setHistoryEmptyMsg] = useState('')
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null)
  const [deleteHistoryItem, setDeleteHistoryItem] = useState<HistoryItem | null>(null)
  const [deletingHistory, setDeletingHistory] = useState(false)
  const pendingEditSeed = useRef(false)

  const showToast = useToast()

  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [showPhotoPermission, setShowPhotoPermission] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const [editForm, setEditForm] = useState<EditForm>({
    name: '', lastname: '', username: '', birthday: '', avatarFile: null,
  })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // รูปโปรไฟล์ที่จำไว้ ใช้แสดงระหว่างรอ API (กันรูปกะพริบ)
  const [cachedAvatar, setCachedAvatarState] = useState<string | null>(getMemoryAvatar)
  const avatarUrl = profile ? avatarUrlFromFile(profile.Profile_Image) : cachedAvatar

  useEffect(() => {
    if (!editForm.avatarFile) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(editForm.avatarFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [editForm.avatarFile])

  const handleAuthExpired = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('user')
    setCachedAvatar(null)
    clearProfileCache()
    showToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'info')
    router.replace('/login')
  }

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${apiBase()}/profile/`, {
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
      })
      if (!res.ok) {
        if (isAuthError(res.status)) { handleAuthExpired(); return }
        showToast(await responseMessage(res, 'ไม่สามารถโหลดข้อมูลโปรไฟล์ได้'), 'error')
        return
      }
      const data = await res.json()
      if (data.data) {
        setProfile(data.data)
        setCachedProfile(data.data)
        if (pendingEditSeed.current) {
          // เปิดหน้าแก้ไขก่อนข้อมูลมาถึง → เติมเฉพาะช่องที่ยังว่าง (ไม่ทับสิ่งที่ผู้ใช้พิมพ์ไปแล้ว)
          pendingEditSeed.current = false
          const p = data.data
          setEditForm(f => ({
            ...f,
            name: f.name || p.Name || '',
            lastname: f.lastname || p.LastName || '',
            username: f.username || p.Username || '',
            birthday: f.birthday || p.Birthday || '',
          }))
        }
        setCachedAvatar(avatarUrlFromFile(data.data.Profile_Image))
      }
    } catch { showToast('ไม่สามารถโหลดข้อมูลโปรไฟล์ได้', 'error') }
  }

  const fetchHistory = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${apiBase()}/history/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        if (isAuthError(res.status)) { handleAuthExpired(); return }
        showToast(await responseMessage(res, 'ไม่สามารถโหลดประวัติได้'), 'error')
        return
      }
      const data = await res.json()
      const list = data.status === 'success' ? data.data : []
      // ไม่มีประวัติ → backend ตอบ status 'empty' พร้อมข้อความที่ใช้แสดง
      setHistoryEmptyMsg(data.status === 'empty' && typeof data.msg === 'string' ? data.msg : '')
      setHistory(list)
      setCachedHistory(list)
    } catch { showToast('ไม่สามารถโหลดประวัติได้', 'error') }
  }

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { router.replace('/login'); return }
    setCachedAvatarState(getCachedAvatar())
    fetchProfile()
    fetchHistory()
    // ตั้งใจโหลดครั้งเดียวตอนเปิดหน้า (fetchProfile/fetchHistory สร้างใหม่ทุก render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const handleLogout = async () => {
    setShowLogoutModal(false)
    // แจ้ง backend ให้ blacklist token (ถ้าล้มเหลวก็ยังออกจากระบบฝั่งหน้าเว็บต่อ)
    let msg = 'ออกจากระบบเรียบร้อยแล้ว'
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${apiBase()}/profile/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) msg = await responseMessage(res, msg)
    } catch {}
    showToast(msg, 'success')
    localStorage.removeItem('access_token')
    localStorage.removeItem('user')
    setCachedAvatar(null)
    clearProfileCache()
    router.push('/login')
  }

  // ลบประวัติการวิเคราะห์ 1 รายการ (DELETE /history/<id>)
  const handleDeleteHistory = async () => {
    const item = deleteHistoryItem
    if (!item || deletingHistory) return
    setDeletingHistory(true)
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${apiBase()}/history/${item.AssessmentID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (isAuthError(res.status)) { handleAuthExpired(); return }
      const msg = await responseMessage(res, res.ok ? 'ลบรายการประวัติเรียบร้อยแล้ว' : 'ลบรายการไม่สำเร็จ')
      if (!res.ok) { showToast(msg, 'error'); return }
      const next = history.filter(h => h.AssessmentID !== item.AssessmentID)
      setHistory(next)
      setCachedHistory(next)
      setDeleteHistoryItem(null)
      showToast(msg, 'success')
      // ลบรายการสุดท้าย → โหลดใหม่เพื่อรับข้อความ "ไม่มีประวัติ" จาก backend
      if (next.length === 0) fetchHistory()
    } catch {
      showToast(MSG_NETWORK_ERROR, 'error')
    } finally {
      setDeletingHistory(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!deletePassword) return showToast('กรุณากรอกรหัสผ่าน', 'error')
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${apiBase()}/profile/delete`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      })
      if (isAuthError(res.status) && res.status !== 401) { handleAuthExpired(); return }
      const data = await readJson(res)
      if (!res.ok) return showToast(data.msg || (res.status >= 500 ? MSG_SERVER_ERROR : 'รหัสผ่านไม่ถูกต้อง'), 'error')
      showToast(data.msg || 'ลบบัญชีผู้ใช้งานเรียบร้อยแล้ว', 'success')
      setShowDeleteConfirm(false)
      localStorage.removeItem('access_token')
      localStorage.removeItem('user')
      setCachedAvatar(null)
      clearProfileCache()
      router.push('/login')
    } catch { showToast('เกิดข้อผิดพลาด กรุณาลองใหม่', 'error') }
  }

  const handleSaveProfile = async () => {
    const username = editForm.username.trim()
    const firstName = editForm.name.trim()
    const lastName = editForm.lastname.trim()
    if (!username || !firstName || !lastName) {
      return showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วนก่อนทำการบันทึก', 'error')
    }
    const nameErr = usernameError(username)
    if (nameErr) return showToast(nameErr, 'error')
    const birth = parseYmd(editForm.birthday || profile?.Birthday || '')
    if (birth && ageFrom(birth) < MIN_AGE) {
      return showToast(`ผู้ใช้ต้องมีอายุตั้งแต่ ${MIN_AGE} ปีขึ้นไป`, 'error')
    }

    const token = localStorage.getItem('access_token')
    const form = new FormData()
    form.append('username', username)
    form.append('firstName', firstName)
    form.append('lastName', lastName)
    form.append('birthDate', editForm.birthday || profile?.Birthday || '')
    if (editForm.avatarFile) {form.append('profileImg', editForm.avatarFile)}

    try {
      const res = await fetch(`${apiBase()}/profile/update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (isAuthError(res.status)) { handleAuthExpired(); return }
      const data = await readJson(res)
      if (res.ok) {
        showToast(data.msg || 'บันทึกข้อมูลเรียบร้อย', 'success')
        setEditForm(f => ({ ...f, avatarFile: null }))
        setPreviewUrl(null)
        await fetchProfile()
        setView('profile')
      } else {
        showToast(data.msg || MSG_SERVER_ERROR, 'error')
      }
    } catch { showToast(MSG_NETWORK_ERROR, 'error') }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setEditForm(f => ({ ...f, avatarFile: file }))
  }

  const openAvatarPicker = () => {
    const input = avatarInputRef.current
    if (!input) return
    input.value = ''   // เลือกไฟล์เดิมซ้ำได้
    input.click()
  }

  // มือถือ: ขอสิทธิ์เข้าถึงอัลบั้มภาพก่อน (ถ้ายังไม่เคยอนุญาต)
  const handlePickAvatar = () => {
    let granted = false
    try { granted = localStorage.getItem(PHOTO_PERMISSION_KEY) === 'granted' } catch {}
    if (granted || !isTouchDevice()) { openAvatarPicker(); return }
    setShowPhotoPermission(true)
  }

  const handlePhotoPermission = (allow: boolean) => {
    setShowPhotoPermission(false)
    if (!allow) { showToast(MSG_PHOTO_PERMISSION, 'error'); return }
    try { localStorage.setItem(PHOTO_PERMISSION_KEY, 'granted') } catch {}
    openAvatarPicker()
  }

  // ปิดหน้าเลือกรูปโดยไม่ได้รูปบนมือถือ → แจ้งให้ตรวจสิทธิ์อัลบั้มภาพ
  const handlePickCancel = useCallback(() => {
    if (isTouchDevice()) showToast(MSG_PHOTO_PERMISSION, 'info')
  }, [showToast])

  const handleGoToEditProfile = () => {
    // ถ้าข้อมูลโปรไฟล์ยังโหลดไม่เสร็จ ให้เติมฟอร์มทีหลังเมื่อ API ตอบ (fetchProfile)
    pendingEditSeed.current = !profile
    setEditForm({
      name: profile?.Name || '',
      lastname: profile?.LastName || '',
      username: profile?.Username || '',
      birthday: profile?.Birthday || '',
      avatarFile: null,
    })
    setView('editProfile')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Mitr:wght@300;400;500;600&family=Sarabun:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .profile-root { min-height: 100vh; font-family: 'Sarabun', sans-serif; background: #faf7f5; overflow-x: clip; }

        /* ── Shared container (เหมือนหน้าบทความ / ติดต่อ) ── */
        .pf-container {
          width: 100%;
          max-width: 1320px;
          margin: 0 auto;
          padding-left: clamp(16px, 3vw, 40px);
          padding-right: clamp(16px, 3vw, 40px);
        }
        .pf-body { padding-top: clamp(24px, 3vw, 36px); }
        .pf-card {
          background: #fff; border-radius: 20px;
          border: 1px solid #f5e6ec; box-shadow: 0 4px 20px rgba(194,24,91,0.06);
        }

        /* ── Hero ── */
        .pf-hero {
          background: linear-gradient(135deg, #1a0a14 0%, #3d1a2e 50%, #6b2646 100%);
          padding: 48px 0 110px; position: relative; overflow: hidden;
        }
        .pf-hero-title {
          font-family: 'Mitr', sans-serif; font-size: clamp(26px, 3.2vw, 38px);
          font-weight: 600; color: #fff; line-height: 1.3;
        }
        .pf-subhero {
          background: linear-gradient(135deg, #1a0a14 0%, #3d1a2e 100%);
          padding: 40px 0 36px; position: relative; overflow: hidden;
        }
        .pf-subhero-title {
          font-family: 'Mitr', sans-serif; font-size: clamp(18px, 2vw, 24px);
          font-weight: 600; color: #fff;
        }

        /* ── Profile layout ── */
        .pf-profile-grid {
          display: grid;
          grid-template-columns: 340px minmax(0, 1fr);
          gap: clamp(16px, 2vw, 28px);
          align-items: start;
          margin-top: -72px;
          position: relative; z-index: 2;
        }
        .pf-profile-card {
          background: #fff; border-radius: 24px;
          border: 1px solid #f5e6ec; box-shadow: 0 8px 32px rgba(194,24,91,0.10);
          padding: 32px 24px 24px;
          display: flex; flex-direction: column; align-items: center; gap: 18px;
          position: sticky; top: 88px;
        }
        .pf-menu-area {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: clamp(16px, 2vw, 24px);
          background: #fff; border-radius: 24px;
          border: 1px solid #f5e6ec; box-shadow: 0 8px 32px rgba(194,24,91,0.08);
          padding: clamp(20px, 2.4vw, 32px);
        }
        .pf-menu-wide { grid-column: 1 / -1; }
        .pf-menu-pair {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
        }
        .pf-menu-section > div > button { background: #fffafc !important; }

        /* ── Edit profile ── */
        .pf-edit-grid {
          display: grid;
          grid-template-columns: 340px minmax(0, 1fr);
          gap: clamp(16px, 2vw, 28px);
          align-items: stretch;
        }
        .pf-form-grid {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 20px;
        }

        /* ── History ── */
        .pf-history-list { display: flex; flex-direction: column; gap: clamp(10px, 1.2vw, 14px); }
        .pf-history-card {
          background: #fff; border-radius: 18px; padding: 14px 18px 14px 14px;
          border: 1px solid #f5e6ec; border-left: 6px solid; box-shadow: 0 2px 12px rgba(194,24,91,0.04);
          display: flex; align-items: center; gap: clamp(14px, 1.8vw, 22px); cursor: pointer;
          opacity: 0; transition: box-shadow 0.18s, transform 0.18s;
        }
        .pf-history-card:hover { box-shadow: 0 8px 24px rgba(194,24,91,0.12); transform: translateY(-1px); }
        .pf-hist-thumb {
          width: clamp(96px, 11vw, 132px); aspect-ratio: 4 / 3; border-radius: 14px;
          object-fit: cover; flex-shrink: 0; background: #fdf6f9; border: 1px solid #f5e6ec; display: block;
        }
        .pf-hist-thumb-empty { display: flex; align-items: center; justify-content: center; }
        .pf-hist-info {
          flex: 1; min-width: 0;
          display: grid; grid-template-columns: minmax(110px, 0.9fr) minmax(120px, 0.9fr) minmax(120px, 1fr) minmax(160px, 1.6fr);
          gap: 10px 18px; align-items: start;
        }
        .pf-hist-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .pf-hist-label { font-size: 11.5px; color: #9e7a8a; font-weight: 500; }
        .pf-hist-value { font-size: 13.5px; color: #1a0a14; font-weight: 500; line-height: 1.5; }
        .pf-hist-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        /* ข้อความยาว (เช่น "ไม่พบความเสี่ยงที่ชัดเจน") ขึ้นบรรทัดใหม่ในป้ายแทนการล้นออกนอกการ์ด */
        .pf-hist-badge {
          display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 12px;
          font-size: 12px; font-weight: 600; line-height: 1.45; max-width: 100%;
        }
        .pf-hist-badge > span:first-child { flex-shrink: 0; }
        .pf-hist-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .pf-hist-trash {
          width: 38px; height: 38px; border-radius: 12px; border: 1px solid #fde2e2; background: #fff5f5;
          color: #ef4444; display: flex; align-items: center; justify-content: center; cursor: pointer;
          transition: background 0.15s, transform 0.15s;
        }
        .pf-hist-trash:hover { background: #fee2e2; transform: scale(1.05); }
        .pf-pager { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; margin-top: 22px; }
        .pf-pager-btn {
          min-width: 38px; height: 38px; padding: 0 10px; border-radius: 12px; border: 1px solid #f5e6ec;
          background: #fff; color: #5a3a4a; font-family: 'Mitr', sans-serif; font-size: 13.5px;
          display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s;
        }
        .pf-pager-btn:hover:not(:disabled) { border-color: #f48fb1; color: #c2185b; }
        .pf-pager-btn.active { background: linear-gradient(135deg, #f06292, #c2185b); color: #fff; border-color: transparent; }
        .pf-pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pf-pager-info { width: 100%; text-align: center; font-size: 12px; color: #9e7a8a; margin-top: 4px; }

        /* ── Docs ── */
        .pf-doc-grid {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: clamp(12px, 1.6vw, 20px);
        }

        /* ── History detail ── */
        .pf-detail-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
          gap: clamp(16px, 2vw, 28px);
          align-items: start;
        }
        .pf-detail-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pf-detail-row { display: flex; gap: 14px; padding: 16px 20px; border-bottom: 1px solid #f5e6ec; }
        .pf-detail-row:nth-child(odd) { border-right: 1px solid #f5e6ec; }
        .pf-detail-row:last-child { border-bottom: none; }
        /* จำนวนแถวคี่: แถวสุดท้ายเต็มความกว้าง / จำนวนคู่: แถวคู่สุดท้ายไม่มีเส้นล่าง */
        .pf-detail-row:last-child:nth-child(odd) { grid-column: 1 / -1; border-right: none; }
        .pf-detail-row:nth-last-child(2):nth-child(odd) { border-bottom: none; }
        .pf-reco-grid {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
        }

        /* ── Responsive ── */
        @media (max-width: 1100px) {
          .pf-menu-area { grid-template-columns: 1fr; }
          .pf-detail-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 900px) {
          .pf-profile-grid, .pf-edit-grid { grid-template-columns: 1fr; }
          .pf-profile-card { position: static; }
          .pf-doc-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .pf-hero { padding: 36px 0 96px; }
          .pf-subhero { padding: 28px 0 24px; }
          .pf-menu-pair, .pf-form-grid, .pf-reco-grid, .pf-detail-rows { grid-template-columns: 1fr; }
          .pf-detail-row:nth-child(odd) { border-right: none; }
          .pf-hist-info { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .pf-hist-wide { grid-column: 1 / -1; }
        }

        .btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 28px; border-radius: 14px; border: none;
          background: linear-gradient(135deg, #f06292, #c2185b);
          color: #fff; font-family: 'Mitr', sans-serif;
          font-size: 14px; font-weight: 500; cursor: pointer;
          box-shadow: 0 6px 24px rgba(194,24,91,0.4);
          transition: transform 0.18s, box-shadow 0.18s;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 32px rgba(194,24,91,0.5); }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeSlideDown { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .modal-overlay {
          position: fixed; inset: 0; z-index: 40;
          display: flex; align-items: flex-end; justify-content: center;
          background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);
        }
        .modal-sheet {
          width: 100%; max-width: 480px; background: #fff;
          border-radius: 28px 28px 0 0; padding: 32px 28px 40px;
          animation: slideUp 0.28s ease; box-shadow: 0 -8px 40px rgba(0,0,0,0.15);
        }
        .modal-handle { width: 40px; height: 4px; border-radius: 2px; background: #e5d0d8; margin: 0 auto 24px; }
      `}</style>

      <div className="profile-root">
        <Navbar />


        {view === 'profile' && (
          <ProfileView
            profile={profile} avatarUrl={avatarUrl} history={history}
            onEditProfile={handleGoToEditProfile}
            onViewHistory={() => setView('history')}
            onViewPrivacy={() => setView('privacy')}
            onViewTerms={() => setView('terms')}
            onLogout={() => setShowLogoutModal(true)}
            onDeleteAccount={() => setShowDeleteModal(true)}
          />
        )}

        {view === 'editProfile' && (
          <EditProfileView
            avatarUrl={avatarUrl} editForm={editForm} setEditForm={setEditForm}
            previewUrl={previewUrl} avatarInputRef={avatarInputRef} handleAvatarChange={handleAvatarChange}
            onPickAvatar={handlePickAvatar} onPickCancel={handlePickCancel}
            handleSaveProfile={handleSaveProfile} onBack={() => setView('profile')}
          />
        )}

        {view === 'history' && (
          <HistoryView history={history} emptyMsg={historyEmptyMsg} onBack={() => setView('profile')}
            onSelectItem={(item) => { setSelectedHistory(item); setView('historyDetail') }}
            onDeleteItem={(item) => setDeleteHistoryItem(item)}
          />
        )}

        {view === 'historyDetail' && selectedHistory && (
          <HistoryDetailView item={selectedHistory} onBack={() => setView('history')} />
        )}

        {view === 'privacy' && (
          <DocView title="ประกาศนโยบายความเป็นส่วนตัว" sections={PRIVACY_TEXT}
            icon={<Shield size={14} />} onBack={() => setView('profile')} />
        )}

        {view === 'terms' && (
          <DocView title="ข้อตกลงเงื่อนไขการใช้งาน" intro={TERMS_INTRO} sections={TERMS_TEXT}
            icon={<FileText size={14} />} onBack={() => setView('profile')} />
        )}

        {/* DELETE HISTORY MODAL */}
        {deleteHistoryItem && (
          <div className="modal-overlay" onClick={() => !deletingHistory && setDeleteHistoryItem(null)}>
            <div className="modal-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="modal-handle" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={26} color="#ef4444" strokeWidth={1.5} />
                </div>
                <h3 style={{ fontFamily: "'Mitr', sans-serif", fontSize: 18, fontWeight: 600, color: '#1a0a14', textAlign: 'center' }}>ลบประวัติการวิเคราะห์นี้ใช่ไหม?</h3>
                <p style={{ fontSize: 13, color: '#9e7a8a', textAlign: 'center', lineHeight: 1.6 }}>
                  {deleteHistoryItem.Detect2 || 'รายการนี้'}
                  {parseServerDate(deleteHistoryItem.Create_At) && ` · ${parseServerDate(deleteHistoryItem.Create_At)!.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}`}
                  <br />เมื่อลบแล้วจะไม่สามารถกู้คืนได้
                </p>
                <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 8 }}>
                  <button disabled={deletingHistory} onClick={() => setDeleteHistoryItem(null)} style={{
                    flex: 1, padding: '14px', borderRadius: 14,
                    border: '1.5px solid rgba(194,24,91,0.2)', background: 'transparent', color: '#c2185b',
                    fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: 'pointer',
                  }}>ยกเลิก</button>
                  <button disabled={deletingHistory} onClick={handleDeleteHistory} style={{
                    flex: 1, padding: '14px', borderRadius: 14, border: 'none',
                    background: 'linear-gradient(135deg, #f87171, #ef4444)', color: '#fff',
                    fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: deletingHistory ? 'wait' : 'pointer',
                    opacity: deletingHistory ? 0.7 : 1, boxShadow: '0 4px 16px rgba(239,68,68,0.35)',
                  }}>{deletingHistory ? 'กำลังลบ...' : 'ลบรายการ'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PHOTO PERMISSION MODAL (มือถือ) */}
        {showPhotoPermission && (
          <div className="modal-overlay" onClick={() => handlePhotoPermission(false)}>
            <div className="modal-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="modal-handle" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg, #fce4ec, #f8bbd0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ImageIcon size={26} color="#c2185b" strokeWidth={1.5} />
                </div>
                <h3 style={{ fontFamily: "'Mitr', sans-serif", fontSize: 18, fontWeight: 600, color: '#1a0a14', textAlign: 'center' }}>อนุญาตให้เข้าถึงรูปภาพ?</h3>
                <p style={{ fontSize: 13, color: '#9e7a8a', textAlign: 'center', lineHeight: 1.6 }}>Lunar Day ต้องการเข้าถึงอัลบั้มภาพของคุณเพื่อเลือกรูปโปรไฟล์</p>
                <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 8 }}>
                  <button onClick={() => handlePhotoPermission(false)} style={{
                    flex: 1, padding: '14px', borderRadius: 14,
                    border: '1.5px solid rgba(194,24,91,0.2)', background: 'transparent', color: '#c2185b',
                    fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: 'pointer',
                  }}>ไม่อนุญาต</button>
                  <button onClick={() => handlePhotoPermission(true)} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>อนุญาต</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LOGOUT MODAL */}
        {showLogoutModal && (
          <div className="modal-overlay" onClick={() => setShowLogoutModal(false)}>
            <div className="modal-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="modal-handle" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg, #fce4ec, #f8bbd0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LogOut size={26} color="#c2185b" strokeWidth={1.5} />
                </div>
                <h3 style={{ fontFamily: "'Mitr', sans-serif", fontSize: 18, fontWeight: 600, color: '#1a0a14', textAlign: 'center' }}>คุณต้องการออกจากระบบใช่ไหม?</h3>
                <p style={{ fontSize: 13, color: '#9e7a8a', textAlign: 'center', lineHeight: 1.6 }}>คุณสามารถเข้าสู่ระบบอีกครั้งได้ตลอดเวลา</p>
                <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 8 }}>
                  <button onClick={() => setShowLogoutModal(false)} style={{
                    flex: 1, padding: '14px', borderRadius: 14,
                    border: '1.5px solid rgba(194,24,91,0.2)', background: 'transparent', color: '#c2185b',
                    fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: 'pointer',
                  }}>ยกเลิก</button>
                  <button onClick={handleLogout} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>ออกจากระบบ</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DELETE MODAL */}
        {showDeleteModal && (
          <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
            <div className="modal-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="modal-handle" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={26} color="#ef4444" strokeWidth={1.5} />
                </div>
                <h3 style={{ fontFamily: "'Mitr', sans-serif", fontSize: 18, fontWeight: 600, color: '#1a0a14', textAlign: 'center' }}>คุณต้องการลบบัญชีผู้ใช้ใช่ไหม?</h3>
                <p style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', lineHeight: 1.7 }}>
                  การกระทำนี้จะลบข้อมูลส่วนบุคคลและข้อมูลสุขภาพทั้งหมดออกจากฐานข้อมูลอย่างถาวร{' '}
                  <span style={{ color: '#c2185b', fontWeight: 500, cursor: 'pointer' }}
                    onClick={() => { setShowDeleteModal(false); setView('privacy') }}>
                    ตามที่ระบุไว้ในประกาศความเป็นส่วนตัว
                  </span>
                </p>
                <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 8 }}>
                  <button onClick={() => setShowDeleteModal(false)} style={{
                    flex: 1, padding: '14px', borderRadius: 14,
                    border: '1.5px solid #fca5a5', background: 'transparent', color: '#ef4444',
                    fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: 'pointer',
                  }}>ยกเลิก</button>
                  <button onClick={() => { setShowDeleteModal(false); setShowDeleteConfirm(true) }} style={{
                    flex: 1, padding: '14px', borderRadius: 14, border: 'none',
                    background: 'linear-gradient(135deg, #f87171, #ef4444)', color: '#fff',
                    fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(239,68,68,0.35)',
                  }}>ยืนยัน</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DELETE CONFIRM */}
        {showDeleteConfirm && (
          <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
            <div className="modal-sheet" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <div className="modal-handle" />
              <h3 style={{ fontFamily: "'Mitr', sans-serif", fontSize: 17, fontWeight: 600, color: '#1a0a14', marginBottom: 6 }}>กรุณากรอกรหัสยืนยันตัวตน</h3>
              <p style={{ fontSize: 13, color: '#9e7a8a', marginBottom: 20 }}>กรอกรหัสผ่านเพื่อยืนยันการลบบัญชี</p>
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="รหัสผ่านของคุณ"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  style={{
                    width: '100%', padding: '11px 48px 11px 16px', lineHeight: '24px',
                    borderRadius: 14, border: '2px solid #fca5a5',
                    fontSize: 14, outline: 'none',
                    fontFamily: "'Sarabun', sans-serif", color: '#1a0a14', background: '#fff',
                  }}
                />
                <button onClick={() => setShowPw(!showPw)} style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#9e7a8a',
                }}>
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => { setShowDeleteConfirm(false); setDeletePassword('') }} style={{
                  flex: 1, padding: '14px', borderRadius: 14,
                  border: '1.5px solid #fca5a5', background: 'transparent', color: '#ef4444',
                  fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: 'pointer',
                }}>ยกเลิก</button>
                <button onClick={handleDeleteAccount} style={{
                  flex: 1, padding: '14px', borderRadius: 14, border: 'none',
                  background: 'linear-gradient(135deg, #f87171, #ef4444)', color: '#fff',
                  fontFamily: "'Mitr', sans-serif", fontSize: 14, cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(239,68,68,0.35)',
                }}>ลบบัญชีผู้ใช้</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  )
}

// ============================================================
// SHARED COMPONENTS
// ============================================================
function MenuItem({ icon, label, desc, onClick, danger = false, badge }: {
  icon: React.ReactNode; label: string; desc?: string;
  onClick: () => void; danger?: boolean; badge?: string
}) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
      padding: '16px 18px', borderRadius: 16,
      background: '#fff', border: `1px solid ${danger ? '#fee2e2' : '#f5e6ec'}`,
      boxShadow: '0 2px 10px rgba(194,24,91,0.04)',
      cursor: 'pointer', textAlign: 'left',
      transition: 'transform 0.15s, box-shadow 0.15s',
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(194,24,91,0.1)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = 'none'
        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(194,24,91,0.04)'
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
        background: danger ? '#fff1f2' : 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: danger ? '#ef4444' : '#c2185b',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: danger ? '#ef4444' : '#1a0a14', fontFamily: "'Mitr', sans-serif" }}>{label}</p>
        {desc && <p style={{ fontSize: 12, color: '#9e7a8a', marginTop: 2 }}>{desc}</p>}
      </div>
      {badge && (
        <span style={{
          padding: '3px 10px', borderRadius: 999,
          background: 'rgba(194,24,91,0.08)', color: '#c2185b',
          fontSize: 12, fontWeight: 600,
        }}>{badge}</span>
      )}
      <ChevronRight size={16} color={danger ? '#fca5a5' : '#d6b4c4'} />
    </button>
  )
}

function FormField({ label, value, onChange, readOnly = false, prefix, icon, onKeyDown, maxLength }: {
  label: string; value: string; onChange?: (v: string) => void;
  readOnly?: boolean; prefix?: string; icon?: React.ReactNode; maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9d174d', marginBottom: 6, paddingLeft: 2 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && (
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#c2185b', fontWeight: 500 }}>{prefix}</span>
        )}
        {icon && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#9e7a8a' }}>{icon}</span>
        )}
        <input
          type="text" value={value} readOnly={readOnly} maxLength={maxLength}
          onChange={e => onChange?.(e.target.value)}
          onKeyDown={e => onKeyDown?.(e)}
          style={{
            // line-height สูงพอให้ "_" ไม่ถูกตัด (ลด padding เท่ากัน ความสูงช่องเท่าเดิม)
            width: '100%', padding: prefix ? '10px 16px 10px 28px' : '10px 16px', lineHeight: '24px',
            borderRadius: 12, border: `2px solid ${readOnly ? '#f3f4f6' : '#fce7f3'}`,
            fontSize: 14, outline: 'none', fontFamily: "'Sarabun', sans-serif",
            background: readOnly ? '#f9fafb' : '#fff',
            color: readOnly ? '#9ca3af' : '#1a0a14',
            cursor: readOnly ? 'not-allowed' : 'text', transition: 'border-color 0.18s',
          }}
          onFocus={e => { if (!readOnly) e.target.style.borderColor = '#f06292' }}
          onBlur={e => { if (!readOnly) e.target.style.borderColor = '#fce7f3' }}
        />
      </div>
      {readOnly && <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, paddingLeft: 2 }}>ไม่สามารถแก้ไขได้</p>}
    </div>
  )
}

function HistoryDetailView({ item, onBack }: { item: HistoryItem; onBack: () => void }) {
  const [detail, setDetail] = useState<HistoryItem>(item)
  const [loading, setLoading] = useState(true)
  const showToast = useToast()
  const router = useRouter()

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const token = localStorage.getItem('access_token')
        // GET /analysis/result/<id> (ตอบเฉพาะผลวิเคราะห์ ไม่มีวันที่ → รวมกับข้อมูลจากรายการเดิมที่มี Create_At)
        const res = await fetch(`${apiBase()}/analysis/result/${item.AssessmentID}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (isAuthError(res.status)) { router.replace('/login'); return }
        if (!res.ok) {
          showToast(await responseMessage(res, 'ไม่สามารถโหลดรายละเอียดได้'), 'error')
          return
        }
        const data = await readJson(res)
        if (data.status === 'success') setDetail(prev => ({ ...prev, ...data.data }))
      } catch {
        showToast(MSG_NETWORK_ERROR, 'error')
      } finally { setLoading(false) }
    }
    fetchDetail()
  }, [item.AssessmentID, showToast, router])

  const cfg = riskStyle(detail.Risk_Level)

  const rows = [
    // Detect2 = ผลภาพที่ละเอียดกว่า (เช่น รวมขนาดลิ่มเลือด) — ไม่มีจึงใช้ Detect1
    { label: 'ผลการวิเคราะห์ภาพ (AI)', value: detail.Detect2 || detail.Detect1, emoji: '🩸' },
    { label: 'โรคที่อาจเกี่ยวข้อง',    value: detail.Potential_Disease, emoji: '🎯' },
    { label: 'ระดับความเสี่ยง',         value: detail.Risk_Level, emoji: '📊' },
    { label: 'วันที่วิเคราะห์', value:
        parseServerDate(detail.Create_At)?.toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' }) ?? '-',
      emoji: '📅' },
  ]

  return (
    <div style={{ paddingBottom: 60 }}>
      <SubHeader title="รายละเอียดการวิเคราะห์" subtitle="ผลการวิเคราะห์ครั้งนี้" onBack={onBack} />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #fce4ec', borderTopColor: '#c2185b', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : (
        <div className="pf-container pf-body">
          <div className="pf-detail-grid">
            {/* LEFT: ภาพที่วิเคราะห์ */}
            <div style={{ background: '#fff', borderRadius: 18, border: '1px solid #f5e6ec', overflow: 'hidden', boxShadow: '0 4px 20px rgba(194,24,91,0.06)' }}>
              <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 13, fontWeight: 600, color: '#9e7a8a', padding: '14px 20px 12px' }}>ภาพที่วิเคราะห์</p>
              {detail.Image_Path ? (
                <img
                  src={backendUrl(resultImagePath(detail.Image_Path))}
                  alt="Analyzed"
                  onError={e => {
                    const img = e.currentTarget
                    if (img.dataset.fallback !== '1') {
                      img.dataset.fallback = '1'
                      img.src = backendUrl(detail.Image_Path ?? '')
                    } else {
                      img.style.display = 'none'
                    }
                  }}
                  style={{
                    width: '100%', display: 'block', objectFit: 'contain', background: '#fdf6f9',
                    // สูงไม่เกิน 360px และไม่เกินครึ่งจอ (จอเล็ก/มือถือไม่ต้องเลื่อนนาน)
                    height: 'min(360px, 50vh)',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9e7a8a', fontSize: 13 }}>ไม่มีรูปภาพสำหรับการวิเคราะห์นี้</div>
              )}
            </div>

            {/* RIGHT: ระดับความเสี่ยง + ข้อมูล */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div style={{
                background: cfg.bg, border: `1.5px solid ${cfg.dot}40`,
                borderRadius: 18, padding: '20px 22px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: cfg.bg, border: `2px solid ${cfg.dot}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Droplets size={24} color={cfg.color} strokeWidth={1.5} />
                </div>
                <div>
                  <p style={{ fontSize: 12, color: cfg.color, fontWeight: 600, marginBottom: 4 }}>ระดับความเสี่ยง</p>
                  <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 22, fontWeight: 600, color: cfg.color }}>{detail.Risk_Level}</p>
                </div>
              </div>

              <div className="pf-detail-rows" style={{ background: '#fff', borderRadius: 18, border: '1px solid #f5e6ec', overflow: 'hidden' }}>
                {rows.map((row, i) => (
                  <div key={i} className="pf-detail-row">
                    <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg, #fce4ec, #f8bbd0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{row.emoji}</div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 11.5, color: '#9e7a8a', marginBottom: 3 }}>{row.label}</p>
                      <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 14, fontWeight: 500, color: '#1a0a14', wordBreak: 'break-word' }}>{row.value || '-'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {detail.Recommendation && (
            <div style={{ marginTop: 'clamp(20px, 2.4vw, 32px)' }}>
              <p style={{ fontFamily: "'Mitr', sans-serif", fontSize: 15, fontWeight: 600, color: '#1a0a14', marginBottom: 12 }}>คำแนะนำ</p>
              <div className="pf-reco-grid">
                {detail.Recommendation.split(/[·•]/).filter(Boolean).map((s: string, i: number) => (
                  <div key={i} style={{ padding: '14px 16px', background: '#fff', borderRadius: 14, border: '1px solid #f5e6ec' }}>
                    <p style={{ fontSize: 13.5, color: '#4a2a3a', lineHeight: 1.6 }}>{s.trim()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
