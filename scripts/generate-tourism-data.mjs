import { writeFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'

const API_URLS = {
  attractions: 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Attraction-json.zip',
  restaurants: 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Restaurant-json.zip',
}

const OUTPUT_DIR = 'public'
const HSINCHU_TOURISM_ORIGIN = 'https://tourism.hccg.gov.tw'
const HSINCHU_TOURISM_QUERY = `${HSINCHU_TOURISM_ORIGIN}/chtravel/app/travel/query?module=travel&id=37`
const FALLBACK_IMAGE_PATH = '/image-unavailable.svg'

const fetchZipJson = async (url, expectedFile) => {
  const response = await fetch(url, {
    headers: { 'user-agent': 'hsinchu-city-vision-exhibition/1.0' },
  })

  if (!response.ok) {
    throw new Error(`Official tourism feed responded with ${response.status}`)
  }

  const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
  const entryName = Object.keys(files).find((name) => name.endsWith(expectedFile))

  if (!entryName) {
    throw new Error(`Missing ${expectedFile} in official tourism feed`)
  }

  const source = files[entryName]
  const text = strFromU8(source).replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

const normalizeText = (value = '') => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const summarize = (value = '', maxLength = 96) => {
  const normalized = normalizeText(value)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

const fetchHsinchuPageMedia = async () => {
  try {
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

    const media = new Map()
    const itemPattern = /<a href="([^"]*\/chtravel\/app\/travel\/view[^"]*)"[^>]*>[\s\S]*?<img[^>]+src="([^"]*\/chtravel\/app\/data\/image[^"]*)"[^>]*>[\s\S]*?<p class="subject">([\s\S]*?)<\/p>/gi

    for (const html of pages) {
      for (const match of html.matchAll(itemPattern)) {
        const name = match[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim()
        const imagePath = match[2]
        const websitePath = match[1]

        if (name && imagePath) {
          media.set(name, {
            image: new URL(imagePath, HSINCHU_TOURISM_ORIGIN).href,
            website: new URL(websitePath, HSINCHU_TOURISM_ORIGIN).href,
          })
        }
      }
    }

    return media
  } catch (error) {
    console.warn(`Unable to fetch Hsinchu tourism images: ${error.message}`)
    return new Map()
  }
}

const buildItem = (item, kind, overrideImage = '') => {
  const name = kind === 'attraction' ? item.AttractionName : item.RestaurantName
  const addressParts = [
    item.PostalAddress?.City,
    item.PostalAddress?.Town,
    item.PostalAddress?.StreetAddress,
  ].filter(Boolean)

  return {
    id: kind === 'attraction' ? item.AttractionID : item.RestaurantID,
    kind,
    name: name || '未命名地點',
    summary: summarize(item.Description),
    description: normalizeText(item.Description),
    image: overrideImage || FALLBACK_IMAGE_PATH,
    imageAlt: item.Images?.[0]?.Description || item.Images?.[0]?.Name || name || '新竹旅遊影像',
    town: item.PostalAddress?.Town || '新竹市',
    address: addressParts.join(''),
    phone: item.Telephones?.[0]?.Tel || '',
    openTime: normalizeText(item.ServiceTimeInfo),
    website: item.WebsiteURL || '',
    latitude: item.PositionLat,
    longitude: item.PositionLon,
    updatedAt: item.UpdateTime || '',
  }
}

const attractionPayload = await fetchZipJson(API_URLS.attractions, 'AttractionList.json')
const restaurantPayload = await fetchZipJson(API_URLS.restaurants, 'RestaurantList.json')
const hsinchuMedia = await fetchHsinchuPageMedia()

const attractions = (attractionPayload.Attractions || [])
  .filter((item) => item.PostalAddress?.City === '新竹市' && item.ServiceStatus !== 0)
  .map((item) => buildItem(item, 'attraction', ''))

const restaurants = (restaurantPayload.Restaurants || [])
  .filter((item) => item.PostalAddress?.City === '新竹市' && item.ServiceStatus !== 0)
  .map((item) => buildItem(item, 'restaurant', ''))

const allItems = [...attractions, ...restaurants]
const seen = new Map()
for (const item of allItems) {
  if (!seen.has(item.name)) {
    seen.set(item.name, item)
  }
}

const uniqueItems = [...seen.values()]

for (const item of uniqueItems) {
  const sourceList = item.kind === 'attraction'
    ? attractionPayload.Attractions || []
    : restaurantPayload.Restaurants || []

  const sourceItem = sourceList.find((entry) => {
    const name = item.kind === 'attraction' ? entry.AttractionName : entry.RestaurantName
    return name === item.name
  })

  const imageUrl = hsinchuMedia.get(item.name)?.image || sourceItem?.Images?.[0]?.URL || ''
  if (!imageUrl || imageUrl.includes('hsinchuemap.tw')) {
    item.image = FALLBACK_IMAGE_PATH
    continue
  }

  item.image = imageUrl.trim().replace(/^http:/, 'https:')
}

const payload = {
  meta: {
    source: '交通部觀光署・觀光資訊資料庫 V2.1',
    sourceUrl: 'https://data.gov.tw/dataset/7777',
    fetchedAt: new Date().toISOString(),
    attractionUpdatedAt: attractionPayload.UpdateTime || '',
    restaurantUpdatedAt: restaurantPayload.UpdateTime || '',
    warnings: [],
  },
  attractions: uniqueItems.filter((item) => item.kind === 'attraction'),
  restaurants: uniqueItems.filter((item) => item.kind === 'restaurant'),
}

await writeFile(`${OUTPUT_DIR}/tourism.json`, JSON.stringify(payload, null, 2))
console.log(`Generated ${OUTPUT_DIR}/tourism.json with ${payload.attractions.length} attractions and ${payload.restaurants.length} restaurants.`)
