import {writeFile} from 'node:fs/promises'
import {strFromU8, unzipSync} from 'fflate'

const API_URLS = {
  attractions:
    'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Attraction-json.zip',
  restaurants:
    'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Restaurant-json.zip',
}

const OUTPUT_DIR = 'public'
const HSINCHU_TOURISM_API = 'https://hsinchuemap.tw/API/api/hccg/front/travel-guide'
const FALLBACK_IMAGE_PATH = '/image-unavailable.svg'

const fetchZipJson = async (url, expectedFile) => {
  const response = await fetch(url, {
    headers: {'user-agent': 'hsinchu-city-vision-exhibition/1.0'},
  })

  if (!response.ok) {
    throw new Error(`Official tourism feed responded with ${response.status}`)
  }

  const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
  const entryName = Object.keys(files).find((name) =>
    name.endsWith(expectedFile),
  )

  if (!entryName) {
    throw new Error(`Missing ${expectedFile} in official tourism feed`)
  }

  const source = files[entryName]
  const text = strFromU8(source).replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

const normalizeText = (value = '') =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const summarize = (value = '', maxLength = 96) => {
  const normalized = normalizeText(value)
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}…`
    : normalized
}

const mediaName = (value = '') => normalizeText(value).normalize('NFKC').replace(/\s+/g, '')

const legacyId = (value = '') => {
  try {
    return new URL(value).searchParams.get('serno') || ''
  } catch {
    return ''
  }
}

const fetchHsinchuPageMedia = async () => {
  const media = new Map()
  for (const [kind, endpoint] of [['attraction', 'attractions'], ['restaurant', 'foods']]) {
    let lastPage = 1
    for (let page = 1; page <= lastPage; page++) {
      const query = new URLSearchParams({
        parentPageID: '3', locale: 'zh-TW', page: String(page), per_page: '100',
      })
      const response = await fetch(`${HSINCHU_TOURISM_API}/${endpoint}?${query}`, {
        signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) throw new Error(`Hsinchu tourism API responded with ${response.status}`)
      const payload = await response.json()
      if (!payload.success || !Array.isArray(payload.data?.sections)) {
        throw new Error('Invalid Hsinchu tourism API response')
      }
      lastPage = payload.data.pagination?.last_page || 1
      for (const section of payload.data.sections) {
        for (const item of section.items || []) {
          const images = [item.image, ...(item.gallery || []).map((image) => image.url)].filter(Boolean)
          const entry = {kind, item, images}
          media.set(`${kind}:${mediaName(item.title)}`, entry)
          const id = legacyId(item.source_url) || legacyId(item.action?.url)
          if (id) media.set(`${kind}:${id}`, entry)
        }
      }
    }
  }
  return media
}

const imageChecks = new Map()
const verifyImage = (source) => {
  if (!imageChecks.has(source)) {
    imageChecks.set(source, (async () => {
      try {
        const url = new URL(source)
        if (url.protocol !== 'https:' || url.pathname === '/chtravel/app/data/image') return false
        const response = await fetch(url, {signal: AbortSignal.timeout(15000)})
        const valid = response.ok && (response.headers.get('content-type') || '').startsWith('image/')
        await response.body?.cancel()
        return valid
      } catch {
        return false
      }
    })())
  }
  return imageChecks.get(source)
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
    imageAlt:
      item.Images?.[0]?.Description ||
      item.Images?.[0]?.Name ||
      name ||
      '新竹旅遊影像',
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

const attractionPayload = await fetchZipJson(
  API_URLS.attractions,
  'AttractionList.json',
)
const restaurantPayload = await fetchZipJson(
  API_URLS.restaurants,
  'RestaurantList.json',
)
const hsinchuMedia = await fetchHsinchuPageMedia()

const attractions = (attractionPayload.Attractions || [])
  .filter(
    (item) => item.PostalAddress?.City === '新竹市' && item.ServiceStatus !== 0,
  )
  .map((item) => buildItem(item, 'attraction', ''))

const restaurants = (restaurantPayload.Restaurants || [])
  .filter(
    (item) => item.PostalAddress?.City === '新竹市' && item.ServiceStatus !== 0,
  )
  .map((item) => buildItem(item, 'restaurant', ''))

const allItems = [...attractions, ...restaurants]
const seen = new Map()
for (const item of allItems) {
  if (!seen.has(item.name)) {
    seen.set(item.name, item)
  }
}

const knownNames = new Set(allItems.map((item) => `${item.kind}:${mediaName(item.name)}`))
const knownLegacyIds = new Set(allItems
  .filter((item) => legacyId(item.website))
  .map((item) => `${item.kind}:${legacyId(item.website)}`))
let addedItems = 0
for (const {kind, item} of new Set(hsinchuMedia.values())) {
  const name = normalizeText(item.title)
  const key = `${kind}:${mediaName(name)}`
  const id = legacyId(item.source_url) || legacyId(item.action?.url)
  if (!name || knownNames.has(key) || (id && knownLegacyIds.has(`${kind}:${id}`))) continue
  const address = normalizeText(item.address)
  const website = item.source_url || item.action?.url || ''
  seen.set(key, {
    id: `Hsinchu_${kind}_${item.id}`,
    kind,
    name,
    summary: summarize(item.summary || item.content),
    description: normalizeText(item.content || item.summary),
    image: FALLBACK_IMAGE_PATH,
    imageAlt: item.image_alt || name,
    town: item.district || address.match(/東區|北區|香山區/)?.[0] || '新竹市',
    address,
    phone: item.phone || '',
    openTime: normalizeText(item.business_hours),
    website: /^https?:\/\//.test(website) && !website.includes('/chtravel/')
      ? website : 'https://tourism.hccg.gov.tw/',
    latitude: item.location?.latitude,
    longitude: item.location?.longitude,
    updatedAt: (item.published_at || '').replaceAll('/', '-'),
  })
  knownNames.add(key)
  if (id) knownLegacyIds.add(`${kind}:${id}`)
  addedItems++
}

const uniqueItems = [...seen.values()]

const warnings = []
const resolveImage = async (item) => {
  const sourceList =
    item.kind === 'attraction'
      ? attractionPayload.Attractions || []
      : restaurantPayload.Restaurants || []

  const sourceItem = sourceList.find((entry) => {
    const name =
      item.kind === 'attraction' ? entry.AttractionName : entry.RestaurantName
    return name === item.name
  })

  const candidates = [
    ...(hsinchuMedia.get(`${item.kind}:${legacyId(item.website)}`)?.images ||
      hsinchuMedia.get(`${item.kind}:${mediaName(item.name)}`)?.images || []),
    ...(sourceItem?.Images || []).map((image) => image.URL),
  ].filter(Boolean)
  for (const candidate of new Set(candidates)) {
    const url = candidate.trim().replace(/^http:/, 'https:')
    if (await verifyImage(url)) {
      item.image = url
      return
    }
  }
  item.image = FALLBACK_IMAGE_PATH
  warnings.push(`No verified image: ${item.name}`)
}
for (let offset = 0; offset < uniqueItems.length; offset += 8) {
  await Promise.all(uniqueItems.slice(offset, offset + 8).map(resolveImage))
}

const payload = {
  meta: {
    source: '交通部觀光署・觀光資訊資料庫 V2.1',
    sourceUrl: 'https://data.gov.tw/dataset/7777',
    imageSource: 'https://hsinchuemap.tw/API/api/hccg/front/travel-guide',
    additionalSource: '新竹市觀光旅遊網',
    fetchedAt: new Date().toISOString(),
    attractionUpdatedAt: attractionPayload.UpdateTime || '',
    restaurantUpdatedAt: restaurantPayload.UpdateTime || '',
    warnings,
  },
  attractions: uniqueItems.filter((item) => item.kind === 'attraction'),
  restaurants: uniqueItems.filter((item) => item.kind === 'restaurant'),
}

await writeFile(`${OUTPUT_DIR}/tourism.json`, JSON.stringify(payload, null, 2))
console.log(
  `Generated ${OUTPUT_DIR}/tourism.json with ${payload.attractions.length} attractions and ${payload.restaurants.length} restaurants.`,
)
console.log(`Verified images: ${uniqueItems.length - warnings.length}; fallback images: ${warnings.length}.`)
console.log(`Added ${addedItems} new places from the Hsinchu tourism API.`)
