-- 0116_drug_high_alert_class.sql   ★ 시안 — **아직 적용하지 않았다**(dryrun 결과만 보고)
--
-- 목적: 고위험 약품의 **라벨 바탕색을 약마다 다르게** 하기 위한 칸을 더한다.
--       원내 게시물 규칙 — 나트륨 초록 / 칼륨 빨강 / 인슐린 살구.
--
-- ★ 왜 색(hex)이 아니라 **갈래 이름**을 저장하나
--   · 색은 바뀔 수 있다. 「인슐린 살구 → 연보라」로 바꾸는 날, DB 1,133줄이 아니라
--     코드 한 곳(labelDefs)만 고치면 된다.
--   · DB 에 `#FED7AA` 같은 글자를 넣으면 오타(`#FED7A`)를 막을 길이 없고,
--     어떤 색이 쓰이고 있는지 세어 보기도 어렵다.
--   · 갈래 이름은 **뜻**이다. 「이 약은 인슐린이라 살구색」이 「이 약은 살구색」보다
--     나중에 읽을 때 분명하다.
--   · 그리고 **화면 코드에 약품코드를 박지 않아도 된다** — 이정화 님이 금지한 방식이다.
--
-- ★ 왜 `drugs` 에 칸을 더하나 (별도 표가 아니라)
--   · 고위험은 이미 `drugs.is_high_alert` 로 같은 줄에 있다. 짝이 되는 값은 옆에 두는 편이
--     읽기도 쓰기도 단순하다(조인이 없다).
--   · 지금 대상이 **4종**이다. 표를 새로 만들면 정책·권한·인덱스를 또 세워야 해 과하다.
--   · 늘어나도 `drugs` 는 1,133줄이라 칸 하나가 부담이 되지 않는다.
--
-- ★ 범위 — **칸 하나만 더한다.**
--   · 값은 넣지 않는다(전부 NULL). 실제 4종 지정은 **미리보기·승인 뒤 별도 단계**다.
--   · 트리거·정책·권한·기존 칸은 **한 글자도 바꾸지 않는다.**
--   · 금액·수량·마감값과 무관하다.
--
-- ★ 허용 목록(CHECK)을 거는 이유
--   아무 글자나 들어오면 라벨이 색을 못 고르고 흰 바탕으로 떨어진다.
--   **DB 에서 막아** 화면이 몰라도 되게 한다. 새 갈래가 생기면 이 목록을 넓힌다
--   (넓히는 변경이라 배포보다 먼저 적용해도 된다 — CLAUDE.md 권한 규칙과 같은 방향).
--
-- ★ 순서 주의 (함정 #22)
--   칸을 더한 뒤 스키마 캐시를 갱신하고, API 에서 보이는 것을 확인한 다음에 화면 코드를 배포한다.

begin;

alter table public.drugs
  add column if not exists high_alert_class text;

do $$
begin
  if not exists (
    select 1 from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname = 'public' and cl.relname = 'drugs'
       and con.conname = 'drugs_high_alert_class_chk')
  then
    alter table public.drugs
      add constraint drugs_high_alert_class_chk
      check (high_alert_class is null
             or high_alert_class in ('electrolyte_na', 'electrolyte_k', 'insulin'));
  end if;
end $$;

comment on column public.drugs.high_alert_class is
  '고위험 갈래 — 라벨 바탕색을 고르는 데 쓴다. electrolyte_na(나트륨·초록) · '
  'electrolyte_k(칼륨·빨강) · insulin(인슐린·살구). 색 값은 src/lib/labelDefs.js 에만 둔다. '
  'is_high_alert 가 거짓이면 쓰이지 않는다. 0116.';

-- 고위험인데 갈래가 비어 있으면 라벨은 흰 바탕 + 고위험 뱃지로 떨어진다(안전한 기본값).
-- 지금은 4종 모두 NULL 이다. 값 넣기는 별도 단계.

notify pgrst, 'reload schema';

commit;
