/* 테마 컨텍스트 단일 출처 — App.jsx에서 추출(순환 import 방지).
   App.jsx와 별도 화면(EmergencyDispense 등)이 이 모듈에서 import한다.
   로직·기본값 변경 없이 정의만 이동. */
import { createContext, useContext } from 'react'

export const ThemeCtx = createContext()
export function useTheme() { return useContext(ThemeCtx) }