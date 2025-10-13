/**
 * API 端點：POST /api/auth/logout
 * 功能：登出使用者並清除所有認證資訊
 *
 * 請求型別：
 * interface LogoutRequest {
 *   // 無請求參數，使用 Cookie 中的 token 識別使用者
 * }
 *
 * 回應型別：
 * interface LogoutResponse {
 *   success: boolean
 *   data: null
 *   message: string[]
 *   notification: null
 *   redirect_url: null
 * }
 *
 * Mock 規則：清除所有認證相關的 Cookie
 */

import { defineEventHandler, deleteCookie, setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  // 設定 JSON 響應格式
  setHeader(event, 'Content-Type', 'application/json')

  // 模擬 API 延遲
  await new Promise(resolve => setTimeout(resolve, 300))

  // 清除認證的 cookie
  deleteCookie(event, 'token')

  return {
    success: true,
    data: null,
    message: ['登出成功'],
    notification: null,
    redirect_url: null,
  }
})
