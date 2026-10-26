'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import './login.css'
import Image from 'next/image'
import { SIGNUP_SUCCESS_KEY, useToast } from '../components/Toast'
import { postJson } from '../lib/postJson'
import { setCachedAvatar } from '../lib/avatarCache'
import { clearProfileCache } from '../lib/profileCache'
import { PASSWORD_MAX, USERNAME_MAX } from '../lib/authRules'
import { apiBase } from '../lib/apiBase'
import { MAX_LOGIN_ATTEMPTS, NO_ATTEMPTS, clearAttempts, currentAttempts, loadAttempts, recordFailure, recordLocked, type AttemptRecord } from '../lib/loginAttempts'

const lockTime = (ms: number) => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

export default function LoginPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [stars, setStars] = useState<Array<React.CSSProperties>>([])
  // จำนวนครั้งที่เข้าสู่ระบบไม่สำเร็จ (โหลดจาก localStorage หลัง mount)
  const [attempts, setAttempts] = useState<AttemptRecord>(NO_ATTEMPTS)
  const [now, setNow] = useState(0)
  // แสดงข้อความ "กรุณาลองใหม่อีกครั้ง (x/3)" เฉพาะหลังกรอกผิดในหน้านี้ (เปิดหน้าใหม่ยังไม่แสดง)
  const [showAttempt, setShowAttempt] = useState(false)
  const showToast = useToast()

  useEffect(() => {
    // ตั้งค่าในเฟรมถัดไป (ไม่ setState ตรง ๆ ใน effect) — ผลที่ผู้ใช้เห็นเหมือนเดิม
    requestAnimationFrame(() => {
      setMounted(true)
      setAttempts(loadAttempts())
      setNow(Date.now())
      setStars(
        Array.from({ length: 28 }).map(() => ({
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          '--dur': `${2.5 + Math.random() * 4}s`,
          '--delay': `${Math.random() * 4}s`,
          '--bright': `${0.4 + Math.random() * 0.6}`,
          width: `${Math.random() > 0.7 ? 4 : 2}px`,
          height: `${Math.random() > 0.7 ? 4 : 2}px`,
        } as React.CSSProperties))
      )
    })
    // มาจากหน้าสมัครสมาชิกที่สำเร็จแล้ว
    try {
      const signupMsg = sessionStorage.getItem(SIGNUP_SUCCESS_KEY)
      if (signupMsg) {
        sessionStorage.removeItem(SIGNUP_SUCCESS_KEY)
        // ใช้ข้อความจาก backend ถ้ามี (ค่า '1' = ไม่มีข้อความ)
        showToast(signupMsg !== '1' ? signupMsg : 'สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ', 'success')
      }
    } catch {}

    // มี token อยู่แล้ว → เช็กกับ backend ก่อนว่ายังใช้ได้ ค่อยพาไปหน้า home
    // (token หมดอายุ/ถูก logout แล้ว → ลบทิ้งและอยู่หน้า login ต่อ)
    const token = localStorage.getItem('access_token')
    if (!token) return
    fetch(`${apiBase()}/profile/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.ok) router.replace('/home')
        else if (res.status === 401 || res.status === 422) {
          localStorage.removeItem('access_token')
          localStorage.removeItem('user')
        }
      })
      .catch(() => {})
  }, [router, showToast])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    const name = username.trim()
    // ช่องว่าง → ส่งให้ backend ตอบข้อความ "กรอกข้อมูลไม่ครบ" เอง
    if (/\s/.test(name)) {
      showToast('ชื่อผู้ใช้ห้ามมีช่องว่าง', 'error')
      return
    }
    if (name.length > USERNAME_MAX) {
      showToast(`ชื่อผู้ใช้ต้องมีความยาวไม่เกิน ${USERNAME_MAX} ตัวอักษร`, 'error')
      return
    }
    if (password.length > PASSWORD_MAX) {
      showToast(`รหัสผ่านต้องมีความยาวไม่เกิน ${PASSWORD_MAX} ตัวอักษร`, 'error')
      return
    }
    // ผิดครบ 3 ครั้ง → ระงับการเข้าสู่ระบบจนพ้นเวลา
    const start = Date.now()
    const lock = currentAttempts(attempts, start).lockedUntil
    setNow(start)
    if (lock) {
      setShowAttempt(true)
      showToast(`เข้าสู่ระบบผิดครบ ${MAX_LOGIN_ATTEMPTS} ครั้ง กรุณาลองใหม่หลังเวลา ${lockTime(lock)} น.`, 'error')
      return
    }
    setLoading(true)

    const result = await postJson<{ access_token: string; user: unknown }>(
      '/auth/login', { username: name, password },
    )
    const at = Date.now()
    setNow(at)
    if (result.data && result.ok) {
      setAttempts(clearAttempts())
      setCachedAvatar(null)
      clearProfileCache()
      localStorage.setItem('access_token', result.data.access_token)
      localStorage.setItem('user', JSON.stringify(result.data.user))
      router.replace('/home')
      return
    }
    // ชื่อผู้ใช้ผิด / รหัสผ่านผิด / ผิดทั้งคู่ → backend ตอบ 401 เหมือนกัน นับเป็น 1 ครั้ง
    if (result.status === 401) {
      setAttempts(r => recordFailure(r, at))
      setShowAttempt(true)
    } else if (result.status === 403 && (result.data as { error_code?: string } | null)?.error_code === 'A11') {
      setAttempts(r => recordLocked(r, at))
      setShowAttempt(true)
    }
    showToast(result.data ? (result.data.msg ?? 'เข้าสู่ระบบไม่สำเร็จ') : result.error, 'error')
    setLoading(false)
  }

  const attempt = currentAttempts(attempts, now)

  return (
    <>

      <div className="login-root">
        <div className="bg-image" />
        <div className="bg-overlay" />

        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />

        {/* Stars — rendered only after mount to avoid hydration mismatch */}
        <div className="stars">
          {stars.map((style, i) => (
            <div key={i} className="star" style={style} />
          ))}
        </div>

        <div className={`card-wrap ${mounted ? 'visible' : ''}`}>
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
          <h1 className="headline">เข้าสู่ระบบ</h1>

          <div className="divider">
            <div className="divider-line" />
            <div className="divider-dot" />
            <div className="divider-line" />
          </div>

          <form onSubmit={handleLogin}>
            <div className="input-group">
              <div className="field-wrap">
                <label className="field-label">ชื่อผู้ใช้</label>
                <input
                  type="text"
                  className={`field-input ${username ? 'has-value' : ''}`}
                  placeholder="กรอกชื่อผู้ใช้ของคุณ"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  maxLength={USERNAME_MAX}
                  autoComplete="username"
                />
              </div>

              <div className="field-wrap">
                <label className="field-label">รหัสผ่าน</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className={`field-input ${password ? 'has-value' : ''}`}
                    placeholder="กรอกรหัสผ่านของคุณ"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    maxLength={PASSWORD_MAX}
                    style={{ paddingRight: '44px' }}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="forgot-row">
              {/* จำนวนครั้งที่กรอกผิด — แสดงหลังกรอกผิดครั้งแรก (ครบ 3 ครั้ง ระงับ 30 นาที) */}
              <span className="attempt-row" aria-live="polite">
                {showAttempt && attempt.count > 0 && `กรุณาลองใหม่อีกครั้ง (${attempt.count}/${MAX_LOGIN_ATTEMPTS})`}
              </span>
              <button type="button" className="forgot-btn" onClick={() => router.push('/forgot-password')}>ลืมรหัสผ่าน?</button>
            </div>

            <button type="submit" className="btn-login" disabled={loading}>
              {loading && <span className="spinner" />}
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <div className="sep">
            <div className="sep-line" />
            <span className="sep-text">หรือ</span>
            <div className="sep-line" />
          </div>

          <p className="signup-row">
            ยังไม่มีบัญชี?
            <button className="signup-btn" onClick={() => router.push('/signup')}>
              สมัครสมาชิก
            </button>
          </p>
        </div>
      </div>
    </>
  )
}