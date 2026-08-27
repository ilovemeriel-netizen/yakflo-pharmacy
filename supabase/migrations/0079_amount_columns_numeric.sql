-- 0079_amount_columns_numeric.sql
-- 목적: 금액 컬럼 3종 bigint → numeric 전환. 수량 계열(numeric, 0012·0013·0015)과 타입 대칭화.
--   · 배경: 금액이 bigint라 소수 금액이 프론트 직접 insert 경로에서 캐스트 실패(22P02)하거나 RPC에서 암묵 반올림.
--     현재는 계산 시점 반올림(PR #242·0078)으로 우회 중이나 프론트 Math.round(half→+∞)와 DB round(half away)가
--     음수 half에서 1원 차이나는 등 근본 해결 아님. numeric 전환 시 반올림 자체가 불필요해지고 편차 소멸.
--   · 값 보존: 정수 → numeric은 무손실(USING ...::numeric). NOT NULL 없음(3종 모두 nullable)·default 0 유지·제약/인덱스 없음.
--   · 영향 조사(0079 Step 0): current_amount를 기입하는 함수/트리거 0개(0009 apply_tx/revert_tx 미참조),
--     total_amount는 bulk_stock_adjust만 참조. monthly_snapshots amount 5종은 이미 numeric(범위 밖).
--     프론트: numeric은 이 스택에서 JS number로 역직렬화(정본 snapshot 합산이 정상 산출로 입증) → 산술/표시 안전.
--   · 컬럼 이름·순서·제약 무변경. 수량 컬럼(quantity·current_qty)은 건드리지 않음(이미 numeric).
--   · dryrun 필수(BEGIN → 검증 → ROLLBACK). apply 미실행(승인 후 별도 적용).

alter table public.transactions    alter column total_amount   type numeric using total_amount::numeric;
alter table public.drugs           alter column current_amount type numeric using current_amount::numeric;
alter table public.inventory_stock alter column current_amount type numeric using current_amount::numeric;

-- 롤백(참고): 정수만 저장돼 있으면 무손실 복원 가능. 소수가 이미 저장된 뒤라면 round 필요.
-- alter table public.transactions    alter column total_amount   type bigint using round(total_amount)::bigint;
-- alter table public.drugs           alter column current_amount type bigint using round(current_amount)::bigint;
-- alter table public.inventory_stock alter column current_amount type bigint using round(current_amount)::bigint;
