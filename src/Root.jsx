import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import Layout from './v2/Layout.jsx'
import RequireAuth from './v2/RequireAuth.jsx'
import Placeholder from './v2/Placeholder.jsx'

/* P2-1 라우팅 골격 (가산적)
   - '/'(및 그 외 모든 경로): 기존 App.jsx 그대로 보존 — 이메일 로그인→drugs 1103 동작 무수정
   - '/app/*': 신규 8메뉴 인터페이스 (인증 게이트 + GNB). 콘텐츠는 P2-2~4에서 구현 */
export default function Root() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/app" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Placeholder title="대시보드" step="P2 / 대시보드" source="drugs(category·status·is_narcotic) 집계 + inventory_stock" />} />
          <Route path="drugs" element={<Placeholder title="약품관리" step="P2-2 / P2-3" source="drugs + drug_vocab(필터) → 약품 360°" />} />
          <Route path="inout" element={<Placeholder title="입출고관리" step="P2-4" source="transactions(type·quantity·unit_price·supplier…)" />} />
          <Route path="inventory" element={<Placeholder title="재고관리" step="P2-4" source="inventory_stock(current_qty·safety_stock·max_stock)" />} />
          <Route path="expiry" element={<Placeholder title="유효기한" step="P2-2 / drug_lots 신설" source="drugs.expiry_date·lot_no (+ drug_lots 예정)" />} />
          <Route path="narcotic" element={<Placeholder title="향정관리" step="P2-2 / P2-3" source="drugs(is_narcotic·narcotic_type) + transactions" />} />
          <Route path="reports" element={<Placeholder title="보고서" step="P2 후속" source="monthly_snapshots(이월·마감)" />} />
          <Route path="settings" element={<Placeholder title="설정" step="P2 후속" source="profiles · tenant_members(권한)" />} />
        </Route>
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  )
}
