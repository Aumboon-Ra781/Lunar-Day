'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TrendingUp, BookOpen, ArrowRight, ChevronRight, Sparkles, Activity, Newspaper, Workflow } from 'lucide-react'
import Navbar from './components/Navbar'
import HeroCharacter from './components/HeroCharacter'
import KnowledgeCarousel from './components/KnowledgeCarousel'
import HowItWorks from './components/HowItWorks'
import api from '../lib/api'
import { useToast } from '../components/Toast'
import { axiosErrorMessage } from '../lib/postJson'
import { apiBase, fixBackendUrl } from '../lib/apiBase'
import type { Article } from '../lib/types'

// ── ดึง URL ภาพปกจากข้อมูลบทความ (ปรับชื่อ field ให้ตรงกับ API ของคุณ) ──
const getCoverUrl = (article: Article): string | null => {
  const raw = article.ImageURL
  if (!raw) return null
  if (/^(https?:)?\/\//.test(raw)) return fixBackendUrl(raw)
  if (raw.startsWith('data:')) return raw
  return `${apiBase()}/${String(raw).replace(/^\//, '')}`
}

function ArticleCover({ article, fallback }: { article: Article; fallback: string }) {
  const [failed, setFailed] = useState(false)
  const url = getCoverUrl(article)

  if (!url || failed) {
    return <span className="article-cover-fallback">{fallback}</span>
  }
  return (
    <img
      src={url}
      alt={article.Title || 'ภาพปกบทความ'}
      className="article-cover-img"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export default function HomePage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [waveBars, setWaveBars] = useState<number[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const showToast = useToast()


  useEffect(() => {
    // ตั้งค่าในเฟรมถัดไป (ไม่ setState ตรง ๆ ใน effect) — ผลที่ผู้ใช้เห็นเหมือนเดิม
    const raf = requestAnimationFrame(() => {
      setMounted(true)
      setWaveBars(
        Array.from({ length: 20 }, (_, i) =>
          20 + Math.sin(i * 0.8) * 14 + Math.random() * 10
        )
      )
    })
    api.get('/articles')
      .then(res => setArticles(res.data))
      .catch(err => showToast(axiosErrorMessage(err, 'โหลดบทความไม่สำเร็จ'), 'error'))
    return () => cancelAnimationFrame(raf)
  }, [showToast])

  const topArticles = [...articles].slice(0, 4)
  const fallbackEmojis = ['🔬', '💊', '🌸', '📊']

  // ── ตรวจ token ก่อนไปหน้าวิเคราะห์ ──
  const goToAnalyze = () => {
    const token = localStorage.getItem('access_token')

    if (!token) {
      showToast('กรุณาเข้าสู่ระบบก่อนใช้งานฟีเจอร์นี้', 'info')
      return
    }

    router.push('/home/analyze')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Mitr:wght@300;400;500;600&family=Sarabun:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .home-root {
          --page-max: 1440px;
          --page-pad: clamp(20px, 5vw, 72px);
          min-height: 100vh;
          font-family: 'Sarabun', sans-serif;
          background: #faf7f5;
          /* clip (ไม่ใช่ hidden) เพื่อไม่ให้แถบเมนู position: sticky หลุด */
          overflow-x: clip;
        }

        /* ── Hero ── */
        .hero {
          position: relative;
          min-height: 520px;
          display: flex;
          align-items: center;
          overflow: hidden;
          background: linear-gradient(135deg, #1a0a14 0%, #3d1a2e 50%, #6b2646 100%);
          padding: 72px var(--page-pad);
        }
        .hero-inner {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: var(--page-max);
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 48px;
        }
        .hero-bg-circles {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .hero-circle {
          position: absolute;
          border-radius: 50%;
          opacity: 0.12;
        }
        .hero-circle-1 {
          width: 600px; height: 600px;
          top: -220px; right: -120px;
          background: radial-gradient(circle, #f48fb1, transparent 60%);
          opacity: 0.2;
        }
        .hero-circle-2 {
          width: 380px; height: 380px;
          bottom: -120px; left: 20%;
          background: radial-gradient(circle, #ce93d8, transparent 60%);
          opacity: 0.15;
        }
        .hero-dots {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 28px 28px;
        }
        .hero-content {
          position: relative;
          z-index: 2;
          flex: 1 1 auto;
          max-width: 680px;
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.8s ease, transform 0.8s ease;
        }
        .hero-content.visible { opacity: 1; transform: translateY(0); }
        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 14px;
          border-radius: 999px;
          background: rgba(240,98,146,0.2);
          border: 1px solid rgba(240,98,146,0.4);
          font-size: 12px;
          color: #f8bbd0;
          font-family: 'Mitr', sans-serif;
          letter-spacing: 0.5px;
          margin-bottom: 20px;
        }
        .hero-title {
          font-family: 'Mitr', sans-serif;
          font-weight: 600;
          font-size: clamp(30px, 4.6vw, 54px);
          color: #fff;
          line-height: 1.3;
          margin-bottom: 16px;
          letter-spacing: 0.3px;
        }
        .hero-desc {
          font-size: 16px;
          color: rgba(255,255,255,0.65);
          line-height: 1.75;
          margin-bottom: 32px;
          max-width: 520px;
        }
        .hero-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 28px;
          border-radius: 14px;
          border: none;
          background: linear-gradient(135deg, #f06292, #c2185b);
          color: #fff;
          font-family: 'Mitr', sans-serif;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          box-shadow: 0 6px 24px rgba(194,24,91,0.45);
          transition: transform 0.18s, box-shadow 0.18s;
          position: relative;
          overflow: hidden;
        }
        .btn-primary::before {
          content: '';
          position: absolute;
          top: 0; left: -100%;
          width: 60%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
          transition: left 0.5s;
        }
        .btn-primary:hover::before { left: 160%; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 32px rgba(194,24,91,0.55); }
        .btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 24px;
          border-radius: 14px;
          border: 1.5px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.07);
          color: rgba(255,255,255,0.85);
          font-family: 'Mitr', sans-serif;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.18s, border-color 0.18s;
        }
        .btn-ghost:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.35); }

        /* Hero graphic (ภาพประกอบเคลื่อนไหว — components/HeroCharacter) */
        .ih-right {
          position: relative; z-index: 2; flex: 1 1 auto;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transform: translateY(20px) scale(0.95);
          transition: opacity 0.9s ease 0.25s, transform 0.9s ease 0.25s;
        }
        .ih-right.visible { opacity: 1; transform: translateY(0) scale(1); }
        .hero-orb-wrap {
          width: 380px; height: 380px; position: relative;
          display: flex; align-items: center; justify-content: center;
        }

        /* ── Section ── */
        .section {
          padding: 64px var(--page-pad);
          max-width: var(--page-max);
          margin: 0 auto;
          width: 100%;
        }
        /* ส่วนข่าวสารอยู่ติดกับส่วนบทความ: ไม่ต้องเว้นด้านล่างซ้อนกัน */
        .section-news { padding-bottom: 0; }
        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 32px;
        }
        .section-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .section-icon {
          width: 34px; height: 34px;
          border-radius: 10px;
          background: linear-gradient(135deg, #fce4ec, #f8bbd0);
          display: flex; align-items: center; justify-content: center;
        }
        .section-title {
          font-family: 'Mitr', sans-serif;
          font-weight: 600;
          font-size: 22px;
          color: #1a0a14;
        }
        .section-subtitle {
          font-size: 13.5px;
          color: #9e7a8a;
          margin-top: 2px;
        }
        .see-all-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 8px 16px;
          border-radius: 10px;
          border: 1.5px solid rgba(194,24,91,0.2);
          background: transparent;
          font-family: 'Sarabun', sans-serif;
          font-size: 13px;
          color: #c2185b;
          cursor: pointer;
          transition: background 0.18s;
        }
        .see-all-btn:hover { background: rgba(194,24,91,0.06); }

        /* ── Article cards (4 อันดับ ขนาดเท่ากัน) ── */
        .articles-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 24px;
        }
        .article-card {
          background: #fff;
          border-radius: 18px;
          border: 1px solid #f5e6ec;
          box-shadow: 0 2px 12px rgba(194,24,91,0.05);
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.22s, box-shadow 0.22s;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .article-card:hover { transform: translateY(-4px); box-shadow: 0 12px 34px rgba(194,24,91,0.14); }

        .article-cover {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 10;
          background: linear-gradient(135deg, #fce4ec, #f8bbd0, #f48fb1);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .article-cover-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.4s ease;
        }
        .article-card:hover .article-cover-img { transform: scale(1.05); }
        .article-cover-fallback { font-size: 56px; }
        .article-cover::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(to top, rgba(26,10,20,0.28), transparent 55%);
          pointer-events: none;
        }

        .article-card-body {
          padding: 18px 20px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex: 1;
        }
        .article-card-title {
          font-family: 'Mitr', sans-serif;
          font-weight: 500;
          font-size: 15px;
          color: #1a0a14;
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: calc(1.5em * 3);
        }
        .read-more {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #c2185b;
          font-size: 13.5px;
          font-weight: 500;
          margin-top: auto;
          padding-top: 12px;
          border-top: 1px solid #f5e6ec;
          transition: gap 0.18s;
        }
        .article-card:hover .read-more { gap: 9px; }

        /* ── CTA ── */
        .cta-wrap {
          padding: 0 var(--page-pad) 64px;
          max-width: var(--page-max);
          margin: 0 auto;
          width: 100%;
        }
        .cta-section {
          border-radius: 26px;
          background: linear-gradient(135deg, #1a0a14 0%, #3d1a2e 100%);
          padding: 56px clamp(24px, 5vw, 72px);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 32px;
          position: relative;
          overflow: hidden;
        }
        .cta-section::before {
          content: '';
          position: absolute;
          top: -60px; right: -60px;
          width: 300px; height: 300px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(240,98,146,0.2), transparent 60%);
        }
        .cta-section::after {
          content: '';
          position: absolute;
          bottom: -40px; left: 20%;
          width: 200px; height: 200px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(206,147,216,0.15), transparent 60%);
        }
        .cta-content { position: relative; z-index: 1; }
        .cta-label {
          font-size: 12px;
          color: rgba(240,98,146,0.8);
          font-family: 'Mitr', sans-serif;
          letter-spacing: 2px;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .cta-title {
          font-family: 'Mitr', sans-serif;
          font-weight: 600;
          font-size: clamp(24px, 3vw, 32px);
          color: #fff;
          line-height: 1.3;
          margin-bottom: 12px;
        }
        .cta-desc { font-size: 14.5px; color: rgba(255,255,255,0.55); }
        .cta-graphic {
          position: relative;
          z-index: 1;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 12px;
        }
        .waveform {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 56px;
          transform: translateX(-20px);
      }
        .wave-bar {
          width: 4px;
          border-radius: 2px;
          background: linear-gradient(to top, rgba(240,98,146,0.3), #f06292);
          animation: wavePulse 1.4s ease-in-out infinite;
        }
        @keyframes wavePulse {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }

        /* ── Responsive ── */
        @media (max-width: 1200px) {
          .articles-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 1024px) {
          .hero-orb-wrap { width: 300px; height: 300px; }
        }
        @media (max-width: 768px) {
          .hero { padding: 48px var(--page-pad); min-height: auto; }
          .ih-right { display: none; }
          .section { padding: 40px var(--page-pad); }
          .cta-wrap { padding-bottom: 40px; }
          .cta-section { padding: 32px 24px; flex-direction: column; align-items: flex-start; }
          .cta-graphic { display: none; }
        }
        @media (max-width: 560px) {
          .articles-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="home-root">
        <Navbar />

        {/* ── Hero ── */}
        <section className="hero">
          <div className="hero-bg-circles">
            <div className="hero-circle hero-circle-1" />
            <div className="hero-circle hero-circle-2" />
            <div className="hero-dots" />
          </div>

          <div className="hero-inner">
            <div className={`hero-content ${mounted ? 'visible' : ''}`}>
              <div className="hero-badge">
                <Sparkles size={11} /> เทคโนโลยีวิเคราะห์ขั้นสูง
              </div>
              <h1 className="hero-title">
                ดูแลสุขภาพสตรี<br />
                ด้วย AI วิเคราะห์ลิ่มเลือด<br />
              </h1>
              <p className="hero-desc">
                วิเคราะห์ผลเลือดประจำเดือนอย่างแม่นยำด้วย AI
                พร้อมคำแนะนำเฉพาะบุคคล เพื่อสุขภาพที่ดีกว่า
              </p>
              <div className="hero-actions">
                <button className="btn-primary" onClick={goToAnalyze}>
                  <Activity size={15} /> เริ่มวิเคราะห์เลย
                </button>
                <button className="btn-ghost" onClick={() => router.push('/home/articles')}>
                  <BookOpen size={15} /> อ่านบทความ
                </button>
              </div>
            </div>
            <div className={`ih-right ${mounted ? 'visible' : ''}`}>
              <div className="hero-orb-wrap">
                <HeroCharacter />
              </div>
            </div>
          </div>
        </section>

        {/* ── Lunar Day ทำงานอย่างไร (แผนภาพเคลื่อนไหว) ── */}
        <div className="section section-news">
          <div className="section-header">
            <div>
              <div className="section-title-wrap">
                <div className="section-icon">
                  <Workflow size={16} color="#c2185b" />
                </div>
                <h2 className="section-title">Lunar Day ทำงานอย่างไร</h2>
              </div>
            </div>
          </div>
          <HowItWorks />
        </div>

        {/* ── ข่าวสารและความรู้ (สไลด์อินโฟกราฟิก) ── */}
        <div className="section section-news">
          <div className="section-header">
            <div>
              <div className="section-title-wrap">
                <div className="section-icon">
                  <Newspaper size={16} color="#c2185b" />
                </div>
                <h2 className="section-title">ข่าวสารและความรู้</h2>
              </div>
            </div>
          </div>
          <KnowledgeCarousel />
        </div>

        {/* ── Articles ── */}
        <div className="section">
          <div className="section-header">
            <div>
              <div className="section-title-wrap">
                <div className="section-icon">
                  <TrendingUp size={16} color="#c2185b" />
                </div>
                <h2 className="section-title">บทความสุขภาพสตรี</h2>
              </div>
              <p className="section-subtitle">บทความแนะนำเพื่อการดูแลสุขภาพสตรี</p>
            </div>
            <button className="see-all-btn" onClick={() => router.push('/home/articles')}>
              ดูทั้งหมด <ChevronRight size={14} />
            </button>
          </div>

          <div className="articles-grid">
            {topArticles.map((article, i) => (
              <div
                key={article.ArticleID}
                className="article-card"
                onClick={() => router.push(`/home/articles/${article.ArticleID}`)}
              >
                <div className="article-cover">
                  <ArticleCover article={article} fallback={fallbackEmojis[i % fallbackEmojis.length]} />
                </div>
                <div className="article-card-body">
                  <h3 className="article-card-title">{article.Title}</h3>
                  <span className="read-more">
                    อ่านต่อ <ArrowRight size={14} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CTA ── */}
        <div className="cta-wrap">
          <div className="cta-section">
            <div className="cta-content">
              <p className="cta-label">✦ เริ่มต้นวันนี้</p>
              <h2 className="cta-title">
                เช็กสุขภาพสตรีเชิงลึก<br />
                ผ่านประจำเดือน
              </h2>
              <p className="cta-desc">รับผลวิเคราะห์ละเอียดพร้อมคำแนะนำเฉพาะบุคคลภายในไม่กี่นาที</p>
              <button className="btn-primary" style={{ marginTop: 24 }} onClick={goToAnalyze}>
                เริ่มวิเคราะห์ฟรี <ArrowRight size={15} />
              </button>
            </div>

            <div className="cta-graphic">
              <div className="waveform">
                {waveBars.map((h, i) => (
                  <div key={i} className="wave-bar" style={{ height: `${h}px`, animationDelay: `${i * 0.09}s` }} />
                ))}
              </div>
              <div style={{
                background: 'rgba(240,98,146,0.12)',
                border: '1px solid rgba(240,98,146,0.25)',
                borderRadius: 14,
                padding: '14px 20px',
                color: '#f48fb1',
                fontFamily: "'Mitr', sans-serif",
                fontSize: 13,
                textAlign: 'center',
              }}>
                🩸 ผลวิเคราะห์พร้อมแล้ว
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}