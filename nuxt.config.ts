import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: ['@nuxt/eslint', '@pinia/nuxt'],
  devtools: {
    enabled: true,
  },

  // 禁用自動導入-1： components
  components: false,

  imports: {
    autoImport: false, // 禁用自動導入-2： composables 和 utils
  },

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: true, // 允許所有主機訪問
    },
  },
  eslint: {
    config: {
      stylistic: true, // 啟用風格檢查
    },
  },
})
