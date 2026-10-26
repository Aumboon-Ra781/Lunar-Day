// ระดับความเสี่ยงของประจำเดือน — ใช้ร่วมกันทั้งหน้าผลการวิเคราะห์และหน้าประวัติ
// key/label = ค่า Risk_Level ที่ backend ส่งมา (ใช้ชื่อเดียวกันทุกที่), meaning = ตามโปรโตไทป์
export type RiskLevel = {
  key: string       // ค่าจาก backend
  label: string     // ชื่อที่แสดงในตารางระดับความเสี่ยง
  meaning: string   // ความหมายของระดับ
  solid: string     // สีหลัก (หัวตาราง / แถบสี)
  onSolid: string   // สีตัวอักษรบนสีหลัก
  tint: string      // พื้นอ่อน (ป้าย / การ์ด)
  ink: string       // สีตัวอักษรบนพื้นขาว/พื้นอ่อน
  icon: string
}

export const NO_CLEAR_RISK = 'ไม่พบความเสี่ยงที่ชัดเจน'

export const RISK_LEVELS: RiskLevel[] = [
  {
    key: 'ปกติ', label: 'ปกติ',
    meaning: 'ลักษณะประจำเดือนอยู่ในเกณฑ์ปกติ ไม่พบความผิดปกติที่น่ากังวล',
    solid: '#3ccf2a', onSolid: '#14361a', tint: '#ecfbe8', ink: '#1f7a16', icon: '✅',
  },
  {
    key: 'เสี่ยงปานกลาง', label: 'เสี่ยงปานกลาง',
    meaning: 'พบความเปลี่ยนแปลงเล็กน้อย ควรเฝ้าสังเกตอาการและติดตามอย่างต่อเนื่อง',
    solid: '#e2dc12', onSolid: '#3b3600', tint: '#fdfbe1', ink: '#8a7a00', icon: '⚡',
  },
  {
    key: 'เสี่ยงสูง', label: 'เสี่ยงสูง',
    meaning: 'พบความผิดปกติที่อาจเกี่ยวข้องกับภาวะทางสุขภาพ ควรปรึกษาแพทย์',
    solid: '#ff8a00', onSolid: '#3d2100', tint: '#fff3e5', ink: '#c25a00', icon: '⚠️',
  },
  {
    key: 'ฉุกเฉิน', label: 'ฉุกเฉิน',
    meaning: 'พบความผิดปกติชัดเจน มีความเสี่ยงต่อโรค ควรพบแพทย์โดยเร็ว',
    solid: '#ff1f1f', onSolid: '#3d0000', tint: '#ffe9e9', ink: '#c81414', icon: '🚨',
  },
  {
    // ใช้เมื่อ backend ไม่พบโรคที่สอดคล้องกับอาการ (A7) — frontend กำหนดเอง เพราะ backend ไม่ได้ส่งระดับมา
    key: NO_CLEAR_RISK, label: NO_CLEAR_RISK,
    meaning: 'อาการที่ระบุยังไม่สามารถประเมินความเสี่ยงที่แน่ชัดได้ แนะนำให้ปรึกษาแพทย์เพื่อการวินิจฉัยเพิ่มเติม',
    solid: '#a3a3ad', onSolid: '#1f2128', tint: '#f3f4f6', ink: '#4b5060', icon: 'ℹ️',
  },
]

export function getRiskLevel(key: string | null | undefined): RiskLevel | null {
  return RISK_LEVELS.find(r => r.key === key) ?? null
}
