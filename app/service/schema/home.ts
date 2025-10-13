import { z } from 'zod'
import { createApiResponseSchema } from './common'

// 功能項目資料結構
export const FeatureItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
})

// 首頁資料結構定義
export const HomeDataSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  description: z.array(z.string()),
  features: z.array(FeatureItemSchema),
})

// 首頁回應 Schema
export const HomeResponseSchema = createApiResponseSchema(HomeDataSchema)

// 型別導出
export type FeatureItem = z.infer<typeof FeatureItemSchema>
export type HomeData = z.infer<typeof HomeDataSchema>

// 用於頁面和 Composable 的型別註解
// 用於 app/composables/page/useHomePage.ts 和 app/pages/index.vue
