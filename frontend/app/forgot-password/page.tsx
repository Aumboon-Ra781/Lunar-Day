'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Lock, Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react'
import './forgot-password.css'
import Image from 'next/image'
import { useToast } from '../components/Toast'
import { postJson } from '../lib/postJson'
import { PASSWORD_HINT, PASSWORD_PLACEHOLDER, passwordRuleError } from '../lib/authRules'
import ScrollingPlaceholder from '../components/ScrollingPlaceholder'

// ── Constants ──────────────────────────────────────────────────────────────
const OTP_LENGTH = 6
const OTP_EXPIRE_SECONDS = 5 * 60  // 5 minutes
const CIRCUMFERENCE = 2 * Math.PI * 14  // r=14

const STEPS = [
  { id: 1, label: 'อีเมล' },
  { id: 2, label: 'OTP'   },
  { id: 3, label: 'รหัส'  },
]

// ── Password strength helper ───────────────────────────────────────────────
function getStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' }
  // นับตามเงื่อนไขรหัสผ่าน (lib/authRules): ครบ 4 ข้อ = แข็งแกร่ง
  let s = 0
  if (pw.trim().length >= 8)        s++
  if (/[a-z]/.test(pw))             s++
  if (/[A-Z]/.test(pw))             s++
  if (/[^A-Za-z0-9\s]/.test(pw))    s++
  const labels = ['', 'อ่อน', 'พอใช้', 'ดี', 'แข็งแกร่ง']
  return { score: s, label: labels[s] }
}

// ── Star helper ───────────────────────────────────────────────────────────
function makeStars(n: number): React.CSSProperties[] {
  return Array.from({ length: n }).map(() => ({
    left: `${Math.random() * 100}%`,
    top:  `${Math.random() * 100}%`,
    '--dur':    `${2.5 + Math.random() * 4}s`,
    '--delay':  `${Math.random() * 4}s`,
    '--bright': `${0.4 + Math.random() * 0.6}`,
    width:  `${Math.random() > 0.7 ? 4 : 2}px`,
    height: `${Math.random() > 0.7 ? 4 : 2}px`,
  } as React.CSSProperties))
}

// ── OTP Input component ───────────────────────────────────────────────────
function OtpInput({
  value, onChange, hasError,
}: { value: string[]; onChange: (v: string[]) => void; hasError: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) {
      refs.current[i - 1]?.focus()
    }
  }

  const handleChange = (i: number, raw: string) => {
    const char = raw.replace(/\D/g, '').slice(-1)
    const next = [...value]
    next[i] = char
    onChange(next)
    if (char && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus()
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    const next = Array.from({ length: OTP_LENGTH }, (_, i) => text[i] ?? '')
    onChange(next)
    refs.current[Math.min(text.length, OTP_LENGTH - 1)]?.focus()
  }

  return (
    <div className="otp-row">
      {Array.from({ length: OTP_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          className={`otp-box${value[i] ? ' filled' : ''}${hasError ? ' error' : ''}`}
          value={value[i] ?? ''}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKey(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  )
}

// ── Timer component ───────────────────────────────────────────────────────
function CountdownTimer({
  seconds,
}: { seconds: number }) {
  const [left, setLeft] = useState(seconds)

  useEffect(() => {
    setLeft(seconds)
  }, [seconds])

  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft(l => l - 1), 1000)
    return () => clearTimeout(id)
  }, [left])

  const pct  = left / OTP_EXPIRE_SECONDS
  const dash = CIRCUMFERENCE * (1 - pct)
  const mm   = String(Math.floor(left / 60)).padStart(2, '0')
  const ss   = String(left % 60).padStart(2, '0')

  return (
    <div className="timer-ring-wrap">
      <div className="timer-ring">
        <svg width="36" height="36" viewBox="0 0 36 36">
          <defs>
            <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#e8639a" />
              <stop offset="100%" stopColor="#c83880" />
            </linearGradient>
          </defs>
          <circle className="timer-ring-bg" cx="18" cy="18" r="14"
            strokeWidth="2.5" fill="none" />
          <circle className="timer-ring-fg" cx="18" cy="18" r="14"
            strokeWidth="2.5" fill="none"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dash}
          />
        </svg>
      </div>
      <span className="timer-digits">{mm}:{ss}</span>
    </div>
  )
}

// ── Password strength bar ─────────────────────────────────────────────────
function StrengthBar({ password }: { password: string }) {
  const { score, label } = getStrength(password)
  if (!password) return null
  const levels = ['', 'weak', 'fair', 'good', 'strong']
  return (
    <div className="pw-strength">
      <div className="pw-strength-bars">
        {[1, 2, 3, 4].map(n => (
          <div
            key={n}
            className={`pw-bar${n <= score ? ' ' + levels[score] : ''}`}
          />
        ))}
      </div>
      <div className="pw-strength-label">{label}</div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function ForgotPasswordPage() {
  const router = useRouter()
  const [mounted,   setMounted]   = useState(false)
  const [step,      setStep]      = useState(1)
  const [animating, setAnimating] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [stars,     setStars]     = useState<React.CSSProperties[]>([])

  // Step 1
  const [email,      setEmail]      = useState('')
  const [emailError, setEmailError] = useState('')

  // Step 2
  const [otp,       setOtp]       = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [otpError,  setOtpError]  = useState(false)
  const [timerKey,  setTimerKey]  = useState(0)

  // Step 3
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw,          setShowPw]          = useState(false)
  const [showConfirm,     setShowConfirm]     = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [pwError,         setPwError]         = useState('')  // ใช้ทำกรอบแดง ข้อความแสดงเป็น toast

  // Step 4 (success)
  const [done, setDone] = useState(false)

  const showToast = useToast()

  useEffect(() => {
    // ตั้งค่าในเฟรมถัดไป (ไม่ setState ตรง ๆ ใน effect) — ผลที่ผู้ใช้เห็นเหมือนเดิม
    const raf = requestAnimationFrame(() => {
      setMounted(true)
      setStars(makeStars(28))
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // ── Transitions ──────────────────────────────────────────────────────────
  const goTo = (target: number) => {
    setAnimating(true)
    setTimeout(() => { setStep(target); setAnimating(false) }, 220)
  }


  // ส่ง (หรือส่งซ้ำ) OTP ไปที่อีเมล — คืน true เมื่อสำเร็จ
  const requestOtp = async () => {
    setLoading(true)
    const result = await postJson('/auth/forgot-password', { email })
    setLoading(false)
    if (result.data && result.ok) {
      showToast(result.data.msg ?? 'ส่งรหัส OTP ไปยังอีเมลของคุณเรียบร้อยแล้ว', 'success')
      return true
    }
    showToast(result.data ? (result.data.msg ?? 'ส่งรหัส OTP ไม่สำเร็จ') : result.error, 'error')
    return false
  }

  const handleSendOTP = async () => {
    if (!email || loading) return
    if (await requestOtp()) setStep(2)
  }

  const handleVerifyOtp = async () => {
    const code = otp.join('')
    if (code.length < OTP_LENGTH) return
    setOtpError(false)
    setLoading(true)
    const result = await postJson('/auth/verify-otp', { email, otp: code })
    setLoading(false)
    if (result.data && result.ok) {
      showToast(result.data.msg ?? 'รหัส OTP ถูกต้อง', 'success')
      goTo(3)
      return
    }
    if (result.data) setOtpError(true)
    showToast(result.data ? (result.data.msg ?? 'รหัส OTP ไม่ถูกต้อง') : result.error, 'error')
  }

  const handleResend = async () => {
    if (loading) return
    if (!(await requestOtp())) return
    setOtp(Array(OTP_LENGTH).fill(''))
    setOtpError(false)
    setTimerKey(k => k + 1)
  }

  // แสดงข้อความเป็น toast และทำกรอบช่องรหัสผ่านเป็นสีแดง
  const failPassword = (msg: string) => {
    setPwError(msg)
    showToast(msg, 'error')
  }

  const handleSetPassword = async () => {
    // หน้า login ตัดช่องว่างหัว-ท้ายรหัสผ่านเสมอ จึงต้องตัดแบบเดียวกันตอนตั้งรหัสใหม่
    const newPassword = password.trim()
    const newConfirm = confirmPassword.trim()
    const ruleErr = passwordRuleError(password)
    if (ruleErr) { failPassword(ruleErr); return }
    if (newPassword !== newConfirm) { failPassword('รหัสผ่านไม่ตรงกัน'); return }
    setPwError('')
    setLoading(true)

    const result = await postJson('/auth/reset-password', {
      email: email,
      otp: otp.join(''),
      newPassword: newPassword,
      confirmPassword: newConfirm,
    })
    setLoading(false)

    if (result.data && result.ok) {
      showToast(result.data.msg ?? 'เปลี่ยนรหัสผ่านสำเร็จ', 'success')
      setDone(true)
      return
    }
    failPassword(result.data ? (result.data.msg ?? 'เปลี่ยนรหัสผ่านไม่สำเร็จ') : result.error)
  }

  // ไม่ล็อกปุ่มเมื่อนับถอยหลังหมด — ให้ backend ตรวจวันหมดอายุและแจ้งข้อความ "รหัส OTP หมดอายุแล้ว" เอง
  const canSubmitOtp = otp.join('').length === OTP_LENGTH

  return (
    <div className="fp-root">
      <div className="bg-image" />
      <div className="bg-overlay" />
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      <div className="stars">
        {stars.map((s, i) => <div key={i} className="star" style={s} />)}
      </div>

      <div className={`card-wrap ${mounted ? 'visible' : ''}`}>
        {/* Moon */}
        <div className="moon-motif" style={{ display: 'flex', justifyContent: 'center' }}>
            <Image 
              src="/logolunar.png" 
              alt="Lunar Day Logo" 
              width={80} 
              height={80}
              style={{ borderRadius: '50%' }}
            />
          </div>

        <p className="app-name">Lunar Day</p>

        {done ? (
          /* ── Success ── */
          <div className="success-wrap">
            <h1 className="headline" style={{ marginBottom: 20 }}>เปลี่ยนรหัสผ่านสำเร็จ</h1>
            <div className="success-icon">✨</div>
            <p className="success-title">พร้อมใช้งานแล้ว!</p>
            <p className="success-sub">รหัสผ่านใหม่ของคุณถูกบันทึกเรียบร้อยแล้ว<br />สามารถเข้าสู่ระบบได้ทันที</p>
            <button className="btn-primary" style={{ width: '100%' }} onClick={() => router.push('/login')}>
              เข้าสู่ระบบ <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          <>
            <h1 className="headline">
              {step === 1 ? 'ลืมรหัสผ่าน' : step === 2 ? 'กรอกรหัส OTP' : 'ตั้งรหัสผ่านใหม่'}
            </h1>
            <p className="subheadline">
              {step === 1
                ? 'กรอกอีเมลที่ใช้ลงทะเบียน เพื่อรับรหัสยืนยัน'
                : step === 2
                ? 'รหัส OTP ถูกส่งไปยังอีเมลของคุณ'
                : 'ตั้งรหัสผ่านใหม่ที่ปลอดภัย'}
            </p>

            {/* Step indicators */}
            <div className="step-progress">
              {STEPS.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <div className={`step-dot ${step === s.id ? 'active' : step > s.id ? 'done' : 'inactive'}`}>
                    {step > s.id ? '✓' : s.id}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`step-line ${step > s.id ? 'done' : 'inactive'}`} />
                  )}
                </div>
              ))}
            </div>

            <div className="divider">
              <div className="divider-line" />
              <div className="divider-dot" />
              <div className="divider-line" />
            </div>

            {/* ── Step 1 ── */}
            <div
              className={`step-content${animating ? ' exit' : ''}`}
              style={{ display: step === 1 ? 'block' : 'none' }}
            >
              <div className="field-wrap">
                <label className="field-label">อีเมล</label>
                <Mail className="field-icon" size={16} />
                <input
                  type="email"
                  className={`field-input${emailError ? ' error' : ''}`}
                  placeholder="example@email.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleSendOTP()}
                />
                {emailError && <p className="field-hint err">{emailError}</p>}
              </div>

              <div className="btn-row" style={{ marginTop: 20 }}>
                <button type="button" className="btn-primary" onClick={handleSendOTP} disabled={loading || !email}>
                  {loading ? <><div className="spinner" /> กำลังส่ง...</> : <>ส่งรหัส OTP <ChevronRight size={16} /></>}
                </button>
              </div>
            </div>

            {/* ── Step 2 ── */}
            <div
              className={`step-content${animating ? ' exit' : ''}`}
              style={{ display: step === 2 ? 'block' : 'none' }}
            >
              <div className="email-badge">
                <p className="email-sent-label">รหัส OTP ถูกส่งไปยังอีเมล</p>
                <span className="email-value">{email || 'your@email.com'}</span>
                <p className="email-note">รหัส OTP ของคุณมีอายุ 5 นาที<br />หลังจากที่คุณได้รับรหัส</p>
              </div>

              <p className="field-label" style={{ textAlign: 'center', marginBottom: 0 }}>ระบุรหัส OTP</p>
              <OtpInput value={otp} onChange={setOtp} hasError={otpError} />

              {/* Countdown */}
              <CountdownTimer
                key={timerKey}
                seconds={OTP_EXPIRE_SECONDS}
              />

              <div className="btn-row" style={{ marginTop: 16 }}>
                <button type="button" className="btn-back" onClick={() => goTo(1)}>
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleVerifyOtp}
                  disabled={!canSubmitOtp || loading}
                >
                  {loading ? <><div className="spinner" /> กำลังตรวจสอบ...</> : <>ยืนยัน OTP <ChevronRight size={16} /></>}
                </button>
              </div>

              <div className="timer-row" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className={`timer-resend ${loading ? 'disabled' : 'active'}`}
                  onClick={handleResend}
                  disabled={loading}
                >
                  ส่ง OTP อีกครั้ง
                </button>
              </div>
            </div>

            {/* ── Step 3 ── */}
            <div
              className={`step-content${animating ? ' exit' : ''}`}
              style={{ display: step === 3 ? 'block' : 'none' }}
            >
              <div className="field-wrap">
                <label className="field-label">รหัสผ่านใหม่</label>
                <Lock className="field-icon" size={16} />
                <input
                  type={showPw ? 'text' : 'password'}
                  className={`field-input${pwError ? ' error' : ''}`}
                  ref={passwordRef}
                  placeholder=""
                  aria-label={`รหัสผ่านใหม่ (${PASSWORD_PLACEHOLDER})`}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setPwError('') }}
                  style={{ paddingRight: 44 }}
                />
                <ScrollingPlaceholder inputRef={passwordRef} text={PASSWORD_PLACEHOLDER} hidden={!!password} />
                <button type="button" className="pw-toggle" onClick={() => setShowPw(v => !v)} tabIndex={-1}>
                  {showPw ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <StrengthBar password={password} />
                <p className="field-hint">{PASSWORD_HINT}</p>
              </div>

              <div className="field-wrap">
                <label className="field-label">ยืนยันรหัสผ่านใหม่</label>
                <Lock className="field-icon" size={16} />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  className={`field-input${pwError === 'รหัสผ่านไม่ตรงกัน' ? ' error' : ''}`}
                  placeholder="พิมพ์รหัสผ่านอีกครั้ง"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setPwError('') }}
                  style={{ paddingRight: 44 }}
                />
                <button type="button" className="pw-toggle" onClick={() => setShowConfirm(v => !v)} tabIndex={-1}>
                  {showConfirm ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
              </div>

              <div className="btn-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn-back" onClick={() => goTo(2)}>
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSetPassword}
                  disabled={!password || !confirmPassword || loading}
                >
                  {loading ? <><div className="spinner" /> กำลังบันทึก...</> : 'บันทึกรหัสผ่าน'}
                </button>
              </div>
            </div>
          </>
        )}

        <p className="footer-row">
          จำรหัสผ่านได้แล้ว?
          <button className="text-btn" onClick={() => router.push('/login')}>
            เข้าสู่ระบบ
          </button>
        </p>
      </div>
    </div>
  )
}