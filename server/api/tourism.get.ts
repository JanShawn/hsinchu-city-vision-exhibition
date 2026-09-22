import { strFromU8, unzipSync } from 'fflate'

type TourismKind = 'attraction' | 'restaurant'

interface RawImage {
  Name?: string
  Description?: string | null
  URL?: string
}

interface RawAddress {
  City?: string
  Town?: string
  StreetAddress?: string
}

interface RawTelephone {
  Tel?: string
}

interface RawTourismItem {
  AttractionID?: string
  AttractionName?: string
  RestaurantID?: string
  RestaurantName?: string
  Description?: string
  PostalAddress?: RawAddress
  Telephones?: RawTelephone[]
  Images?: RawImage[]
  ServiceTimeInfo?: string
  ServiceStatus?: number
  WebsiteURL?: string
  PositionLat?: number
  PositionLon?: number
  UpdateTime?: string
}

interface AttractionPayload {
  UpdateTime?: string
  Attractions?: RawTourismItem[]
}

interface RestaurantPayload {
  UpdateTime?: string
  Restaurants?: RawTourismItem[]
}

interface HsinchuPageMedia {
  image: string
  website: string
}

const API_URLS = {
  attractions: 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Attraction-json.zip',
  restaurants: 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Restaurant-json.zip',
}

const HSINCHU_TOURISM_ORIGIN = 'https://tourism.hccg.gov.tw'
const HSINCHU_TOURISM_QUERY = `${HSINCHU_TOURISM_ORIGIN}/chtravel/app/travel/query?module=travel&id=37`

const attractionPriority = [
  '新竹市政府(新竹州廳)',
  '新竹火車站',
  '迎曦門(東門城)',
  '新竹州圖書館',
  '新竹市美術館',
  '新竹都城隍廟',
  '新竹市立動物園',
  '玻璃工藝博物館',
  '青草湖',
  '十八尖山',
  '新竹漁港',
  '香山濕地賞蟹步道',
  '青青草原',
]

const restaurantPriority = [
  '葉大粒粉圓',
  '鴨肉許',
  '新竹水潤餅',
  '竹蓮肉圓',
  '西市米粉湯',
  '彭成珍餅舖',
  '鉄燒餃子',
  '窯食',
  '貳參咖啡二店',
  '一想一響咖啡',
]

const normalizeText = (value = '') => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const decodeHtml = (value = '') => normalizeText(value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))))

const summarize = (value = '', maxLength = 96) => {
  const normalized = normalizeText(value)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

const normalizeImageUrl = (value = '') => value.trim().replace(/^http:/, 'https:')

const fetchJsonFromZip = async <T>(url: string, expectedFile: string): Promise<T> => {
  const response = await fetch(url, {
    headers: { 'user-agent': 'hsinchu-city-vision-exhibition/1.0' },
  })

  if (!response.ok) {
    throw new Error(`Official tourism feed responded with ${response.status}`)
  }

  const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
  const entryName = Object.keys(files).find(name => name.endsWith(expectedFile))

  if (!entryName) {
    throw new Error(`Missing ${expectedFile} in official tourism feed`)
  }

  const file = files[entryName]
  if (!file) {
    throw new Error(`Unable to read ${expectedFile} from official tourism feed`)
  }

  const json = strFromU8(file).replace(/^\uFEFF/, '')
  return JSON.parse(json) as T
}

const fetchHsinchuPageMedia = async () => {
  const pages = await Promise.all([0, 1, 2].map(async (page) => {
    const body = new URLSearchParams({
      dataClass: '',
      keyword: '',
      page: String(page),
      pageSize: '100',
    })

    const response = await fetch(HSINCHU_TOURISM_QUERY, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Mozilla/5.0 (compatible; HsinchuCityGuide/1.0)',
      },
      body,
    })

    if (!response.ok) {
      throw new Error(`Hsinchu tourism website responded with ${response.status}`)
    }

    return response.text()
  }))

  const media = new Map<string, HsinchuPageMedia>()
  const itemPattern = /<a href="([^"]*\/chtravel\/app\/travel\/view[^"]*)"[^>]*>[\s\S]*?<img[^>]+src="([^"]*\/chtravel\/app\/data\/image[^"]*)"[^>]*>[\s\S]*?<p class="subject">([\s\S]*?)<\/p>/gi

  for (const html of pages) {
    for (const match of html.matchAll(itemPattern)) {
      const name = decodeHtml(match[3])
      const imagePath = decodeHtml(match[2])
      const websitePath = decodeHtml(match[1])

      if (name && imagePath) {
        media.set(name, {
          image: new URL(imagePath, HSINCHU_TOURISM_ORIGIN).href,
          website: new URL(websitePath, HSINCHU_TOURISM_ORIGIN).href,
        })
      }
    }
  }

  return media
}

const mapItem = (item: RawTourismItem, kind: TourismKind, media: Map<string, HsinchuPageMedia>) => {
  const name = kind === 'attraction' ? item.AttractionName : item.RestaurantName
  const officialPage = media.get(name || '')
  const addressParts = [item.PostalAddress?.City, item.PostalAddress?.Town, item.PostalAddress?.StreetAddress]
    .filter(Boolean)

  return {
    id: kind === 'attraction' ? item.AttractionID : item.RestaurantID,
    kind,
    name: name || '未命名地點',
    summary: summarize(item.Description),
    description: normalizeText(item.Description),
    image: officialPage ? `/api/tourism-image?src=${encodeURIComponent(officialPage.image)}` : normalizeImageUrl(item.Images?.[0]?.URL),
    imageAlt: item.Images?.[0]?.Description || item.Images?.[0]?.Name || name || '新竹旅遊影像',
    town: item.PostalAddress?.Town || '新竹市',
    address: addressParts.join(''),
    phone: item.Telephones?.[0]?.Tel || '',
    openTime: normalizeText(item.ServiceTimeInfo),
    website: officialPage?.website || item.WebsiteURL || '',
    latitude: item.PositionLat,
    longitude: item.PositionLon,
    updatedAt: item.UpdateTime || '',
    imageVerified: Boolean(officialPage),
  }
}

const hasEmbeddedUrl = (value = '') => /(?:https?:\/\/|www\.)/i.test(value)
const isTrafficInformationRecord = (item: ReturnType<typeof mapItem>) =>
  item.name === '十八尖山' && /^(?:交通資訊|交通方式|交通指南)/.test(item.description)

const dedupeItemsByName = (items: ReturnType<typeof mapItem>[]) => {
  const uniqueItems = new Map<string, ReturnType<typeof mapItem>>()

  for (const item of items) {
    const current = uniqueItems.get(item.name)
    const shouldPreferItem = current && hasEmbeddedUrl(current.description) && !hasEmbeddedUrl(item.description)

    if (!current || shouldPreferItem) uniqueItems.set(item.name, item)
  }

  return [...uniqueItems.values()]
}

const rankItems = (items: ReturnType<typeof mapItem>[], priorities: string[]) => {
  const priorityMap = new Map(priorities.map((name, index) => [name, index]))

  return items.sort((first, second) => {
    const firstRank = priorityMap.get(first.name) ?? priorities.length + 1
    const secondRank = priorityMap.get(second.name) ?? priorities.length + 1
    return firstRank - secondRank || second.updatedAt.localeCompare(first.updatedAt)
  })
}

export default defineCachedEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'public, max-age=3600, stale-while-revalidate=86400')

  const [attractionResult, restaurantResult, mediaResult] = await Promise.allSettled([
    fetchJsonFromZip<AttractionPayload>(API_URLS.attractions, 'AttractionList.json'),
    fetchJsonFromZip<RestaurantPayload>(API_URLS.restaurants, 'RestaurantList.json'),
    fetchHsinchuPageMedia(),
  ])

  const attractionPayload = attractionResult.status === 'fulfilled' ? attractionResult.value : undefined
  const restaurantPayload = restaurantResult.status === 'fulfilled' ? restaurantResult.value : undefined
  const media = mediaResult.status === 'fulfilled' ? mediaResult.value : new Map<string, HsinchuPageMedia>()

  if (!attractionPayload && !restaurantPayload) {
    throw createError({
      statusCode: 502,
      statusMessage: '目前無法取得交通部觀光署資料，請稍後再試。',
    })
  }

  const attractions = rankItems(
    dedupeItemsByName((attractionPayload?.Attractions || [])
      .filter(item => item.PostalAddress?.City === '新竹市' && item.Images?.[0]?.URL && item.ServiceStatus !== 0)
      .map(item => mapItem(item, 'attraction', media))
      .filter(item => !isTrafficInformationRecord(item))),
    attractionPriority,
  ).filter(item => item.imageVerified).slice(0, 24)

  const restaurants = rankItems(
    dedupeItemsByName((restaurantPayload?.Restaurants || [])
      .filter(item => item.PostalAddress?.City === '新竹市' && item.Images?.[0]?.URL && item.ServiceStatus !== 0)
      .map(item => mapItem(item, 'restaurant', media))),
    restaurantPriority,
  ).filter(item => item.imageVerified).slice(0, 24)

  return {
    meta: {
      source: '交通部觀光署・觀光資訊資料庫 V2.1',
      imageSource: '新竹市觀光旅遊網',
      sourceUrl: 'https://data.gov.tw/dataset/7777',
      fetchedAt: new Date().toISOString(),
      attractionUpdatedAt: attractionPayload?.UpdateTime || '',
      restaurantUpdatedAt: restaurantPayload?.UpdateTime || '',
      warnings: [
        attractionResult.status === 'rejected' ? '景點資料暫時無法取得' : '',
        restaurantResult.status === 'rejected' ? '餐飲資料暫時無法取得' : '',
        mediaResult.status === 'rejected' ? '新竹市觀光旅遊網圖片暫時無法取得' : '',
      ].filter(Boolean),
    },
    attractions,
    restaurants,
  }
}, {
  maxAge: 60 * 60 * 6,
  name: 'hsinchu-tourism-feed-v3',
})
