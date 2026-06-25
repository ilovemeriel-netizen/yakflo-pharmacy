-- ════════════════════════════════════════════════════════════════
-- Yakflo · 0028 drug_vocab 쓰기 정책 명시화 (admin 전용) — 가역
-- 실행: Supabase Management API. drop/create policy(재실행 안전).
--
-- 배경: drug_vocab(공유 통제어휘 25행, tenant_id 없음)는 SELECT allow_all(공유 읽기)·
--   INSERT/UPDATE/DELETE 정책 부재(=RLS 기본 거부로 차단). 안전하나 admin조차 쓰기 불가.
-- 변경: 쓰기를 is_admin()(profiles.role='admin')에게만 허용하는 명시적 정책 가산.
--   SELECT 공유 정책·25행 데이터 무변경. allow_all 신규 도입 없음(쓰기는 admin 한정).
-- ▶ is_admin(): 0001 계열 SECURITY DEFINER 헬퍼. GRANT는 이미 authenticated 보유.
-- ════════════════════════════════════════════════════════════════

drop policy if exists drug_vocab_ins_admin on public.drug_vocab;
create policy drug_vocab_ins_admin on public.drug_vocab
  for insert with check (public.is_admin());

drop policy if exists drug_vocab_upd_admin on public.drug_vocab;
create policy drug_vocab_upd_admin on public.drug_vocab
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists drug_vocab_del_admin on public.drug_vocab;
create policy drug_vocab_del_admin on public.drug_vocab
  for delete using (public.is_admin());

-- ════════════════════════════════════════════════════════════════
-- 롤백 (역방향) — 쓰기 정책 제거 시 다시 '쓰기 차단'(정책 부재) 상태로 복귀
-- drop policy if exists drug_vocab_ins_admin on public.drug_vocab;
-- drop policy if exists drug_vocab_upd_admin on public.drug_vocab;
-- drop policy if exists drug_vocab_del_admin on public.drug_vocab;
-- ════════════════════════════════════════════════════════════════