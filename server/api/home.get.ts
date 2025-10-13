/**
 * API 端點：GET /api/home
 * 功能：獲取首頁資料
 *
 * 請求型別：
 * interface HomeRequest {
 *   // GET 請求，無請求參數
 * }
 *
 * 回應型別：
 * interface HomeResponse {
 *   success: boolean
 *   data: {
 *     title: string
 *     subtitle: string
 *     description: string[]
 *     features: Array<{
 *       id: string
 *       name: string
 *       description: string
 *       icon: string
 *     }>
 *   } | null
 *   message: string[]
 *   notification: null
 *   redirect_url: null
 * }
 *
 * Mock 規則：返回固定的首頁展示資料
 */

import { defineEventHandler, setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  // 設定 JSON 響應格式
  setHeader(event, 'Content-Type', 'application/json')

  // 模擬 API 延遲
  await new Promise(resolve => setTimeout(resolve, 500))

  return {
    success: true,
    data: {
      title: 'Vurbo AI Enterprise',
      subtitle: '企業級 AI 開發平台',
      description: [
        '這個專案採用了 eslint-plugin-format 作為程式碼格式化工具。',
        '身份管理採用 Pinia 進行前端狀態管理，並支援 Cookie 持久化。',
        '展示現代化的前端開發架構。',
        '整合了 TypeScript、Vue 3、Nuxt 4、Tailwind CSS 等技術棧。',
      ],
      features: [
        {
          id: 'feature-1',
          name: '統一開發規範',
          description: '提供完整的開發指南和最佳實踐，確保程式碼品質一致性',
          icon: '📋',
        },
        {
          id: 'feature-2',
          name: '型別安全',
          description: '使用 TypeScript 和 Zod 確保完整的型別安全和資料驗證',
          icon: '🛡️',
        },
        {
          id: 'feature-3',
          name: '現代化架構',
          description: '基於 Nuxt 4、Vue 3 和 Pinia 的現代化前端架構',
          icon: '🚀',
        },
        {
          id: 'feature-4',
          name: '響應式設計',
          description: '使用 Tailwind CSS 打造響應式的用戶界面',
          icon: '📱',
        },
      ],
    },
    message: ['首頁資料載入成功'],
    notification: null,
    redirect_url: null,
  }
})
