import { z } from 'zod'
import { createApiResponseSchema } from './common'

// 使用者資料結構定義
export const UserDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

// 登入請求參數 Schema
export const LoginRequestSchema = z.object({
  email: z.string().email('請輸入有效的電子郵件'),
  password: z.string().min(1, '密碼不能為空'),
})

// 登入回應 Schema
export const LoginDataSchema = z.object({
  token: z.string(),
  user: UserDataSchema,
})

export const LoginResponseSchema = createApiResponseSchema(LoginDataSchema)

// 登出回應 Schema（無資料返回）
export const LogoutResponseSchema = createApiResponseSchema(z.null())

// 用戶資訊回應 Schema
export const UserResponseSchema = createApiResponseSchema(UserDataSchema)

// 型別導出
export type UserData = z.infer<typeof UserDataSchema>
export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type LoginData = z.infer<typeof LoginDataSchema>

// 用於頁面和 Composable 的型別註解
// 用於 app/composables/page/useLoginPage.ts 和 app/pages/login.vue
export interface LoginFormData {
  email: string
  password: string
}
