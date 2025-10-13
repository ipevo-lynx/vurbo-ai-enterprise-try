import { useFetch } from '#app'

import { validateSchema } from '~/service/schema/common'
import { HomeResponseSchema } from '~/service/schema/home'

export function useHomePage() {
  const fetchHomeData = async () => {
    return await useFetch('/api/home', {
      key: 'home-page',
      server: true,
      transform: response => validateSchema(HomeResponseSchema, response, '載入首頁資料'),
    })
  }

  return { fetchHomeData }
}
