-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0024 Realtime 발행(publication) 등록 — 재고/거래 즉시 반영 — 가역
-- 실행: Supabase Management API. DO 블록으로 멱등(이미 등록 시 무시).
--
-- 목적: transactions·drugs·inventory_stock 변경을 Realtime(postgres_changes)으로 구독 →
--   커밋 즉시 재고·대시보드 갱신. 구독은 RLS 경유(테넌트 행만 전달).
-- ▶ RLS는 기존 정책 그대로. publication 등록만 추가(가산). 데이터 무변경.
-- ════════════════════════════════════════════════════════════════

do $$ begin
  alter publication supabase_realtime add table public.transactions;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.drugs;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.inventory_stock;
exception when duplicate_object then null; end $$;

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향)
-- alter publication supabase_realtime drop table public.transactions;
-- alter publication supabase_realtime drop table public.drugs;
-- alter publication supabase_realtime drop table public.inventory_stock;
-- ════════════════════════════════════════════════════════════════