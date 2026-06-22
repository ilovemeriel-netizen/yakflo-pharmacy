import DrugListView from '../DrugListView'

/* 중지 약품 아카이브 — 복귀(중지→사용) 가능. 동일 그리드 재사용. */
export default function ArchivePage() {
  return (
    <DrugListView
      title="중지 약품 (아카이브)"
      subtitle="중지된 약품 — '복귀'로 사용 상태로 되돌릴 수 있습니다."
      baseStatuses={['중지']}
      rowAction="restore"
    />
  )
}
