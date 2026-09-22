export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const source = typeof query.src === 'string' ? query.src : ''

  if (!source) {
    throw createError({ statusCode: 400, statusMessage: 'Missing image source.' })
  }

  let sourceUrl: URL
  try {
    sourceUrl = new URL(source)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid image source.' })
  }

  const isOfficialImage = sourceUrl.origin === 'https://tourism.hccg.gov.tw'
    && sourceUrl.pathname === '/chtravel/app/data/image'

  if (!isOfficialImage) {
    throw createError({ statusCode: 403, statusMessage: 'Only official Hsinchu tourism images are allowed.' })
  }

  const response = await fetch(sourceUrl, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; HsinchuCityGuide/1.0)' },
  })

  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: 'Official image is temporarily unavailable.' })
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) {
    throw createError({ statusCode: 502, statusMessage: 'Official source did not return an image.' })
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
})
