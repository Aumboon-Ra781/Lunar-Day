'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Search, ChevronRight } from 'lucide-react'
import Navbar from '../components/Navbar'
import api from '../../lib/api'
import { useToast } from '../../components/Toast'
import { axiosErrorMessage } from '../../lib/postJson'
import { fixBackendUrl } from '../../lib/apiBase'

// ความกว้างเนื้อหา + ระยะขอบข้าง (ปรับตามขนาดจอ) ใช้ร่วมกันทั้ง Header และรายการบทความ
const CONTAINER: React.CSSProperties = {
  width: '100%',
  maxWidth: 1320,
  margin: '0 auto',
  paddingLeft: 'clamp(16px, 3vw, 40px)',
  paddingRight: 'clamp(16px, 3vw, 40px)',
  boxSizing: 'border-box',
}

// กริดแบบแน่นขึ้น: การ์ดกว้างขั้นต่ำ 240px → จอใหญ่ได้ 4-5 คอลัมน์
const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
  gap: 'clamp(14px, 1.6vw, 22px)',
}

// รูปแบบข้อมูลจาก GET /articles และ /articles/search
type ArticleItem = { ArticleID: number; Title: string; ImageURL?: string | null }

export default function ArticlesPage() {
  const router = useRouter()
  const [articles, setArticles] = useState<ArticleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // ผลค้นหาจาก backend (null = ไม่ได้ค้นหา → แสดงบทความทั้งหมด)
  const [results, setResults] = useState<ArticleItem[] | null>(null)
  const [emptyMsg, setEmptyMsg] = useState('ไม่พบบทความที่ค้นหา')
  const searchSeq = useRef(0)

  const showToast = useToast()

  useEffect(() => {
    api.get('/articles')
      .then(res => setArticles(res.data))
      .catch(err => showToast(axiosErrorMessage(err, 'โหลดบทความไม่สำเร็จ'), 'error'))
      .finally(() => setLoading(false))
  }, [showToast])

  // ค้นหาผ่าน GET /articles/search?q= (ค้นทั้งชื่อและเนื้อหาบทความ)
  // รอพิมพ์เสร็จ 350ms ค่อยเรียก และไม่ใช้ผลของคำค้นเก่าที่ตอบกลับมาช้า
  useEffect(() => {
    const q = search.trim()
    const seq = ++searchSeq.current
    if (!q) return   // ไม่ได้ค้นหา → แสดงบทความทั้งหมด (ดู filtered ด้านล่าง)
    const t = setTimeout(() => {
      api.get('/articles/search', { params: { q } })
        .then(res => { if (seq === searchSeq.current) setResults(res.data) })
        .catch(err => {
          if (seq !== searchSeq.current) return
          if (err?.response?.status === 404) {
            // ไม่พบผลลัพธ์: แสดงข้อความจาก backend ในหน้า (ไม่เด้ง toast ทุกครั้งที่พิมพ์)
            setEmptyMsg(axiosErrorMessage(err, 'ไม่พบบทความที่ค้นหา'))
            setResults([])
          } else {
            showToast(axiosErrorMessage(err, 'ค้นหาบทความไม่สำเร็จ'), 'error')
          }
        })
    }, 350)
    return () => clearTimeout(t)
  }, [search, showToast])

  const searching = search.trim() !== ''

  // กด Enter / คลิกแว่นขยาย: ถ้ายังไม่ได้พิมพ์คำค้น → แจ้งเตือน (มีคำค้นอยู่แล้วระบบค้นหาให้อัตโนมัติ)
  const submitSearch = () => {
    if (!searching) showToast('กรุณาใส่คำค้นหา', 'info')
  }
  const filtered = searching ? (results ?? articles) : articles

  const emojis = ['🔬', '💊', '🌸', '📊', '🩸', '💉', '🧬', '🫀']

  return (
    <div style={{ minHeight: '100vh', background: '#faf7f5', fontFamily: "'Sarabun', sans-serif" }}>
      <Navbar />

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg,#1a0a14,#3d1a2e,#6b2646)',
        padding: '40px 0 36px',
      }}>
        <div style={{
          ...CONTAINER,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <BookOpen size={22} color="#f48fb1" />
              <h1 style={{ fontFamily: 'Mitr, sans-serif', fontWeight: 600, fontSize: 28, color: '#fff', margin: 0 }}>
                บทความสุขภาพ
              </h1>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, margin: 0 }}>
              ความรู้เกี่ยวกับสุขภาพสตรีและการดูแลตัวเอง
              {!loading && articles.length > 0 && (
                <span style={{ marginLeft: 8, color: '#f48fb1' }}>
                  · {searching && results ? `พบ ${results.length} บทความ` : `${articles.length} บทความ`}
                </span>
              )}
            </p>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: 520 }}>
            {/* ไอคอนแว่นขยายกดค้นหาได้ (ตำแหน่งเดิม: padding 6 + left 8 = ไอคอนอยู่ที่ 14px) */}
            <button type="button" onClick={submitSearch} aria-label="ค้นหา" style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', padding: 6, cursor: 'pointer',
              display: 'flex', color: 'rgba(255,255,255,0.4)',
            }}>
              <Search size={15} />
            </button>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitSearch() }}
              aria-label="ค้นหาบทความ"
              placeholder="ค้นหาจากชื่อหรือเนื้อหาบทความ..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 16px 12px 40px',
                borderRadius: 12,
                border: '1.5px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: 14,
                fontFamily: 'Sarabun, sans-serif',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>

      {/* Articles List */}
      <div style={{ ...CONTAINER, paddingTop: 32, paddingBottom: 48 }}>

        {/* Skeleton (ใช้กริดเดียวกับรายการจริง) */}
        {loading && (
          <div style={GRID}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 16, border: '1px solid #f5e6ec', overflow: 'hidden' }}>
                <div style={{ height: 150, background: '#f5e6ec' }} />
                <div style={{ padding: 16 }}>
                  <div style={{ height: 16, borderRadius: 6, background: '#f5e6ec', marginBottom: 10, width: '80%' }} />
                  <div style={{ height: 12, borderRadius: 6, background: '#f5e6ec', width: '60%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#9e7a8a' }}>
            <BookOpen size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p style={{ fontSize: 15 }}>{emptyMsg}</p>
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <div style={GRID}>
            {filtered.map((article, i) => (
              // ไม่ใช้ data-reveal กับการ์ดบทความ: บนมือถือการ์ดที่รอปรากฏ (opacity 0 + blur) บางใบไม่แสดงขึ้นมา
              <div
                key={article.ArticleID}
                onClick={() => router.push(`/home/articles/${article.ArticleID}`)}
                style={{
                  background: '#fff',
                  borderRadius: 16,
                  border: '1px solid #f5e6ec',
                  boxShadow: '0 2px 12px rgba(194,24,91,0.05)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.22s, box-shadow 0.22s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = '0 10px 32px rgba(194,24,91,0.12)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'
                  ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(194,24,91,0.05)'
                }}
              >
                {/* Image */}
                <div style={{
                  height: 150,
                  background: article.ImageURL
                    ? `url(${fixBackendUrl(article.ImageURL)}) center/cover no-repeat`
                    : 'linear-gradient(135deg,#fce4ec,#f8bbd0)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 48,
                }}>
                  {!article.ImageURL && emojis[i % emojis.length]}
                </div>

                {/* Body */}
                <div style={{ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h3 style={{
                    fontFamily: 'Mitr, sans-serif',
                    fontWeight: 500,
                    fontSize: 15,
                    color: '#1a0a14',
                    lineHeight: 1.5,
                    margin: '0 0 12px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  } as React.CSSProperties}>
                    {article.Title}
                  </h3>
                  <div style={{
                    marginTop: 'auto',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    color: '#c2185b', fontSize: 13, fontWeight: 500,
                  }}>
                    อ่านต่อ <ChevronRight size={14} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
