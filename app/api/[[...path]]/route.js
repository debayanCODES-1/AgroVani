import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'
import { fetchWeather } from '@/lib/adapters/weather'
import { fetchSprayWindow, fetchHydricStress, geocodeLocation } from '@/lib/adapters/cehub'
import { computeStressDiagnostic, computeFarmEconomics, CROP_LIST, PRODUCT_CATALOG } from '@/lib/calculations/cropRecommendation'
import { computeResidue, computeFieldReadiness, DISTRICT_DATA, getDistrictData } from '@/lib/calculations/residueRecommendation'
import { buildGeminiVisionPrompt, parseGeminiResponse, mapSymptomsToRecommendation } from '@/lib/ai/gemini'
import { createSupabaseDb, getSupabaseServerClient } from '@/lib/supabase/server'

let client
let db
let memoryDb = null
let supabaseDb = null

function createMemoryCollection(initialRows = []) {
  const rows = [...initialRows]

  const makeQueryMatcher = (query = {}) => (row) => Object.entries(query).every(([key, value]) => {
    if (value === undefined) return true
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value).every(([nestedKey, nestedValue]) => {
        const source = row[key]
        if (source && typeof source === 'object') return source[nestedKey] === nestedValue
        return false
      })
    }
    return row[key] === value
  })

  return {
    async countDocuments() {
      return rows.length
    },
    async insertMany(items) {
      rows.push(...items)
      return { insertedCount: items.length }
    },
    async insertOne(item) {
      rows.push(item)
      return { insertedId: item.id || rows.length }
    },
    async updateOne(query, update) {
      const row = rows.find(makeQueryMatcher(query))
      if (!row) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(row, update.$set || update)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    find(query = {}) {
      const filtered = rows.filter(makeQueryMatcher(query))

      let sortSpec = null
      let limitValue = null

      return {
        sort(spec) {
          sortSpec = spec
          return this
        },
        limit(value) {
          limitValue = value
          return this
        },
        async toArray() {
          let result = [...filtered]
          if (sortSpec) {
            const entries = Object.entries(sortSpec)
            result.sort((a, b) => {
              for (const [key, direction] of entries) {
                const delta = (a[key] ?? 0) > (b[key] ?? 0) ? 1 : -1
                if ((a[key] ?? 0) === (b[key] ?? 0)) continue
                return direction === -1 ? -delta : delta
              }
              return 0
            })
          }
          if (limitValue !== null) result = result.slice(0, limitValue)
          return result
        },
      }
    },
    async findOne(query = {}) {
      return rows.find(makeQueryMatcher(query)) || null
    },
  }
}

function createMemoryDb() {
  const collections = {
    farms: createMemoryCollection(),
    machinery: createMemoryCollection(),
    district_metrics: createMemoryCollection(),
    stress_diagnostic_logs: createMemoryCollection(),
    bookings: createMemoryCollection(),
    marketplace_listings: createMemoryCollection(),
    marketplace_orders: createMemoryCollection(),
    admin_reviews: createMemoryCollection(),
  }

  return {
    collection(name) {
      if (!collections[name]) collections[name] = createMemoryCollection()
      return collections[name]
    },
  }
}

async function connectToMongo() {
  if (memoryDb) return memoryDb

  if (!process.env.MONGO_URL || !process.env.DB_NAME) {
    memoryDb = createMemoryDb()
    return memoryDb
  }

  try {
    if (!client) {
      client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 })
      await client.connect()
      db = client.db(process.env.DB_NAME)
    }
    if (db) return db
    throw new Error('MongoDB connection did not return a database')
  } catch (error) {
    console.warn('MongoDB unavailable, falling back to in-memory store for Vercel deployment:', error.message)
    client = null
    memoryDb = createMemoryDb()
    return memoryDb
  }
}

function connectToDatabase() {
  if (supabaseDb) return supabaseDb
  const supabase = getSupabaseServerClient()
  if (supabase) {
    supabaseDb = createSupabaseDb(supabase)
    return supabaseDb
  }
  return connectToMongo()
}

function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

function ok(data, status = 200) {
  return handleCORS(NextResponse.json(data, { status }))
}

export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 200 }))
}

const SEED_FARMS = [
  { name: 'Gurpreet Singh', village: 'Patiala', district: 'Patiala', state: 'Punjab', cropType: 'Rice', areaInAcres: 6, latitude: 30.3398, longitude: 76.3869, soilPh: 6.4, nitrogenKgPerHa: 95 },
  { name: 'Harjinder Kaur', village: 'Ludhiana', district: 'Ludhiana', state: 'Punjab', cropType: 'Wheat', areaInAcres: 8, latitude: 30.901, longitude: 75.8573, soilPh: 6.8, nitrogenKgPerHa: 110 },
  { name: 'Ramesh Patel', village: 'Indore', district: 'Indore', state: 'Madhya Pradesh', cropType: 'Soybean', areaInAcres: 5, latitude: 22.7196, longitude: 75.8577, soilPh: 6.2, nitrogenKgPerHa: 80 },
  { name: 'Vijay Deshmukh', village: 'Nagpur', district: 'Nagpur', state: 'Maharashtra', cropType: 'Cotton', areaInAcres: 7, latitude: 21.1458, longitude: 79.0882, soilPh: 7.1, nitrogenKgPerHa: 105 },
  { name: 'Lakshmi Reddy', village: 'Guntur', district: 'Guntur', state: 'Andhra Pradesh', cropType: 'Rice', areaInAcres: 9, latitude: 16.3067, longitude: 80.4365, soilPh: 6.6, nitrogenKgPerHa: 120 },
]

const SEED_MACHINERY = [
  { type: 'Happy Seeder', provider: 'Patiala Agri Co-op', district: 'Patiala', pricePerAcre: 1200, available: true, lat: 30.35, lon: 76.40 },
  { type: 'Baler', provider: 'Green Fields Custom Hiring', district: 'Ludhiana', pricePerAcre: 1500, available: true, lat: 30.91, lon: 75.86 },
  { type: 'Mulcher', provider: 'Malwa Machinery Hub', district: 'Patiala', pricePerAcre: 1000, available: true, lat: 30.31, lon: 76.36 },
  { type: 'Boom Sprayer', provider: 'AgroSpray Services', district: 'Indore', pricePerAcre: 600, available: true, lat: 22.72, lon: 75.86 },
  { type: 'Happy Seeder', provider: 'Vidarbha Farm Tech', district: 'Nagpur', pricePerAcre: 1300, available: true, lat: 21.15, lon: 79.09 },
]

async function seedDb(db) {
  const farmsCol = db.collection('farms')
  const farmCount = await farmsCol.countDocuments()
  let seededFarms = false
  if (farmCount === 0) {
    const now = new Date()
    const farms = SEED_FARMS.map((farm) => ({ id: uuidv4(), ...farm, createdAt: now }))
    await farmsCol.insertMany(farms)
    seededFarms = true
  }

  const machineryCol = db.collection('machinery')
  if (await machineryCol.countDocuments() === 0) {
    await machineryCol.insertMany(SEED_MACHINERY.map((item) => ({ id: uuidv4(), ...item })))
  }
  const metricsCol = db.collection('district_metrics')
  if (await metricsCol.countDocuments() === 0) {
    const metrics = Object.entries(DISTRICT_DATA).map(([district, values]) => ({ id: uuidv4(), district, ...values }))
    await metricsCol.insertMany(metrics)
  }
  return { seeded: seededFarms, referenceDataReady: true }
}

async function createAssistantReply(db, body) {
  if (!process.env.GEMINI_API_KEY) return ok({ error: 'Gemini voice assistant is not configured' }, 503)

  const farm = body.farmId ? await db.collection('farms').findOne({ id: body.farmId }) : null
  if (body.farmId && !farm) return ok({ error: 'Farm not found' }, 404)

  const farmContext = farm
    ? `Farmer: ${farm.name}. Location: ${farm.village}, ${farm.district}, ${farm.state}. Crop: ${farm.cropType}. Area: ${farm.areaInAcres} acres. Soil pH: ${farm.soilPh ?? 'unknown'}. Nitrogen: ${farm.nitrogenKgPerHa ?? 'unknown'} kg/ha.`
    : 'No farm profile is available yet.'
  const liveContext = body.context ? `Current dashboard data (may be stale): ${JSON.stringify(body.context)}` : ''
  const language = body.locale === 'hi' ? 'Hindi' : body.locale === 'pa' ? 'Punjabi' : 'English'
  const systemInstruction = [
    'You are AgroVani, a concise and practical agricultural voice advisor for Indian farmers.',
    `Speak in ${language}. If the farmer speaks another supported Indian language, follow their language.`,
    'Use simple words, short sentences, and quantities with units. Ask one clarifying question when essential.',
    'Never invent weather, disease diagnoses, pesticide doses, or prices. Recommend consulting a local agronomist for high-risk chemical or medical questions.',
    farmContext,
    liveContext,
  ].join('\n')
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: body.message || '' }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    console.error('Gemini assistant error:', data)
    if (response.status === 401 || response.status === 403) {
      return ok({ error: 'Voice assistant authentication failed. Add a valid GEMINI_API_KEY in .env and restart the server.' }, 502)
    }
    return ok({ error: 'Unable to get an assistant response. Please try again.' }, 502)
  }
  const reply = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
  return reply ? ok({ reply }) : ok({ error: 'Assistant returned an empty response' }, 502)
}

async function createGeminiAudioReply(db, body) {
  if (!process.env.GEMINI_API_KEY) return ok({ error: 'Gemini voice assistant is not configured' }, 503)

  const audioData = typeof body?.audio === 'string' ? body.audio : ''
  if (!audioData) return ok({ error: 'Please record a voice question first.' }, 400)

  const farm = body.farmId ? await db.collection('farms').findOne({ id: body.farmId }) : null
  const farmContext = farm
    ? `Farmer: ${farm.name}. Location: ${farm.village}, ${farm.district}, ${farm.state}. Crop: ${farm.cropType}. Area: ${farm.areaInAcres} acres. Soil pH: ${farm.soilPh ?? 'unknown'}. Nitrogen: ${farm.nitrogenKgPerHa ?? 'unknown'} kg/ha.`
    : 'No farm profile is available yet.'
  const language = body.locale === 'hi' ? 'Hindi' : body.locale === 'pa' ? 'Punjabi' : 'English'
  const instruction = [
    'You are AgroVani, a concise and practical agricultural voice advisor for Indian farmers.',
    `Understand the recorded farmer question and answer in ${language}, or in the language spoken by the farmer.`,
    'Return only the spoken answer as plain text, with short sentences and no markdown.',
    'Never invent weather, disease diagnoses, pesticide doses, or prices. Recommend a local agronomist for high-risk chemical questions.',
    farmContext,
    body.context ? `Current dashboard data: ${JSON.stringify(body.context)}` : '',
  ].filter(Boolean).join('\n')
  const mimeType = typeof body.mimeType === 'string' && body.mimeType.startsWith('audio/') ? body.mimeType : 'audio/webm'
  const base64 = audioData.includes('base64,') ? audioData.split('base64,')[1] : audioData
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instruction }] },
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: base64 } }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Gemini audio assistant error:', data)
    return ok({ error: 'Gemini could not understand the recording. Please try again.' }, 502)
  }
  const reply = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
  return reply ? ok({ reply }) : ok({ error: 'Gemini returned an empty voice response' }, 502)
}

async function createGeminiVisionDiagnosis(body) {
  if (!process.env.GEMINI_API_KEY) {
    return ok({ error: 'Gemini API is not configured. Add GEMINI_API_KEY to the server environment.' }, 503)
  }

  const imageData = typeof body?.image === 'string' ? body.image : ''
  if (!imageData) {
    return ok({ error: 'Please upload a crop image before running the diagnosis.' }, 400)
  }

  const mimeType = typeof body?.mimeType === 'string' && body.mimeType.startsWith('image/') ? body.mimeType : 'image/jpeg'
  const base64 = imageData.includes('base64,') ? imageData.split('base64,')[1] : imageData
  const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash'

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: buildGeminiVisionPrompt({ cropType: body?.cropType || 'Rice', farmName: body?.farmName || 'Farmer', location: body?.location || '' }) },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
      },
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Gemini vision error:', data)
    return ok({ error: 'Gemini crop diagnosis failed. Check the image payload and GEMINI_API_KEY.' }, 502)
  }

  const parsed = parseGeminiResponse(data)
  const mapped = mapSymptomsToRecommendation({ cropType: body?.cropType || 'Rice', issue: parsed.issue, symptoms: parsed.symptoms || [parsed.issue] })
  const matchedProduct = PRODUCT_CATALOG.find((product) => product.name.toLowerCase() === String(parsed.product || mapped.product).toLowerCase())
  const dosageGuidance = matchedProduct
    ? `No dose is inferred from an image alone. Confirm ${matchedProduct.name} is registered for this crop and target, then follow the current India label for formulation, dose, water volume, and safety interval.`
    : 'No product dose is inferred from an image alone. Confirm the diagnosis with field scouting and follow the current registered India label.'

  return ok({
    ...parsed,
    mappedRecommendation: mapped,
    detectedIssue: parsed.issue || mapped.product,
    recommendation: parsed.recommendation || mapped.recommendation,
    product: parsed.product || mapped.product,
    category: parsed.category || mapped.category,
    confidence: Number(parsed.confidence ?? 0.7),
    dosageGuidance,
  })
}

async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method
  const { searchParams } = new URL(request.url)

  try {
    if (route === '/livekit/token' && method === 'POST') {
      if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
        return ok({ error: 'LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.' }, 503)
      }
      const room = `agrovani-${uuidv4()}`
      const identity = `farmer-${uuidv4()}`
      const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity })
      token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
      return ok({ token: await token.toJwt(), url: process.env.LIVEKIT_URL, room })
    }

    if (route === '/crop-diagnose' && method === 'POST') {
      return createGeminiVisionDiagnosis(await request.json())
    }

    if (route === '/products' && method === 'GET') {
      const category = searchParams.get('category')
      const crop = searchParams.get('crop')
      const products = PRODUCT_CATALOG.filter((product) => !category || product.category === category)
        .filter((product) => !crop || !product.crops || product.crops.includes(crop))
        .map((product) => ({
          ...product,
          dosage: product.dosage || null,
          dosageGuidance: product.dosage
            ? `${product.dosage.rateMlPerLitre} ml/L. Verify the current registered India label after confirming the crop, target, formulation, water volume, and safety interval.`
            : 'Verify the current registered India label after confirming the crop, target, formulation, water volume, and safety interval. The API never invents a chemical dose.',
        }))
      return ok({ products, count: products.length })
    }

    const db = await connectToDatabase()

    if (route === '/assistant' && method === 'POST') {
      return createAssistantReply(db, await request.json())
    }

    if (route === '/assistant/audio' && method === 'POST') {
      return createGeminiAudioReply(db, await request.json())
    }

    if ((route === '/' || route === '/root') && method === 'GET') {
      return ok({ message: 'AgroVani API', crops: CROP_LIST })
    }

    if (route === '/seed' && method === 'POST') {
      const result = await seedDb(db)
      return ok(result)
    }

    if (route === '/geocode' && method === 'GET') {
      const query = searchParams.get('query') || ''
      if (!query) return ok({ results: [] })
      const results = await geocodeLocation(query)
      return ok({ results })
    }

    if (route === '/farms' && method === 'POST') {
      const body = await request.json()
      const farm = {
        id: uuidv4(),
        name: body.name || 'Farmer',
        village: body.village || '',
        district: body.district || 'India',
        state: body.state || '',
        cropType: body.cropType || 'Rice',
        areaInAcres: Number(body.areaInAcres) || 1,
        latitude: Number(body.latitude) || 20.5937,
        longitude: Number(body.longitude) || 78.9629,
        soilPh: body.soilPh != null ? Number(body.soilPh) : null,
        nitrogenKgPerHa: body.nitrogenKgPerHa != null ? Number(body.nitrogenKgPerHa) : null,
        locale: body.locale || 'en',
        createdAt: new Date(),
      }
      await db.collection('farms').insertOne(farm)
      const { _id, ...clean } = farm
      return ok(clean)
    }

    if (route === '/farms' && method === 'GET') {
      const id = searchParams.get('id')
      if (id) {
        const farm = await db.collection('farms').findOne({ id })
        if (!farm) return ok({ error: 'Farm not found' }, 404)
        const { _id, ...clean } = farm
        return ok(clean)
      }
      await seedDb(db)
      const farms = await db.collection('farms').find({}).limit(100).toArray()
      return ok(farms.map(({ _id, ...rest }) => rest))
    }

    if (route === '/marketplace/listings' && method === 'GET') {
      const sellerId = searchParams.get('sellerId')
      const query = sellerId ? { sellerId } : {}
      const listings = await db.collection('marketplace_listings').find(query).sort({ createdAt: -1 }).limit(200).toArray()
      return ok(listings.map(({ _id, ...rest }) => rest))
    }

    if (route === '/marketplace/listings' && method === 'POST') {
      const body = await request.json()
      if (!body.sellerId || !body.name || Number(body.priceInr) <= 0) return ok({ error: 'sellerId, name and a positive price are required' }, 400)
      const listing = {
        id: uuidv4(), sellerId: body.sellerId, name: body.name.trim(), category: body.category || 'Other',
        priceInr: Number(body.priceInr), stockUnits: Math.max(0, Number(body.stockUnits) || 0), status: 'active',
        createdAt: new Date(), updatedAt: new Date(),
      }
      await db.collection('marketplace_listings').insertOne(listing)
      return ok(listing, 201)
    }

    if (route === '/marketplace/orders' && method === 'GET') {
      const sellerId = searchParams.get('sellerId')
      const query = sellerId ? { sellerId } : {}
      const orders = await db.collection('marketplace_orders').find(query).sort({ createdAt: -1 }).limit(200).toArray()
      return ok(orders.map(({ _id, ...rest }) => rest))
    }

    if (route === '/marketplace/orders' && method === 'POST') {
      const body = await request.json()
      const quantity = Math.max(1, Number(body.quantity) || 1)
      if (!body.sellerId || !body.listingId) return ok({ error: 'sellerId and listingId are required' }, 400)
      const order = { id: uuidv4(), listingId: body.listingId, farmId: body.farmId || null, sellerId: body.sellerId, quantity, totalInr: Number(body.totalInr) || 0, status: 'new', createdAt: new Date(), updatedAt: new Date() }
      await db.collection('marketplace_orders').insertOne(order)
      return ok(order, 201)
    }

    if (route === '/marketplace/orders' && method === 'PATCH') {
      const body = await request.json()
      const order = await db.collection('marketplace_orders').findOne({ id: body.id })
      if (!order) return ok({ error: 'Order not found' }, 404)
      const nextStatus = body.status || 'packed'
      if (!['new', 'packed', 'out_for_delivery', 'delivered'].includes(nextStatus)) return ok({ error: 'Invalid order status' }, 400)
      order.status = nextStatus
      order.updatedAt = new Date()
      if (db.collection('marketplace_orders').updateOne) await db.collection('marketplace_orders').updateOne({ id: order.id }, { $set: order })
      return ok(order)
    }

    if (route === '/admin/overview' && method === 'GET') {
      const [farms, bookings, logs, metrics] = await Promise.all([
        db.collection('farms').find({}).limit(1000).toArray(),
        db.collection('bookings').find({}).limit(1000).toArray(),
        db.collection('stress_diagnostic_logs').find({}).limit(1000).toArray(),
        db.collection('district_metrics').find({}).limit(1000).toArray(),
      ])
      const districts = metrics.map((metric) => {
        const districtFarms = farms.filter((farm) => farm.state === metric.state || farm.district === metric.district)
        return { ...metric, farmers: districtFarms.length, coverage: districtFarms.length ? Math.min(100, Math.round((districtFarms.filter((farm) => farm.latitude && farm.longitude).length / districtFarms.length) * 100)) : 0 }
      })
      return ok({ farmers: farms.length, bookings: bookings.length, diagnostics: logs.length, districts })
    }

    if (route === '/admin/reviews' && method === 'GET') {
      const reviews = await db.collection('admin_reviews').find({}).sort({ createdAt: -1 }).limit(200).toArray()
      const farms = await db.collection('farms').find({}).limit(1000).toArray()
      const reviewRows = reviews.length ? reviews : farms.map((farm) => ({ id: `farm-${farm.id}`, farmId: farm.id, reviewType: 'Farm verification', status: 'open', createdAt: farm.createdAt }))
      return ok(reviewRows.map((review) => ({ ...review, farm: farms.find((farm) => farm.id === review.farmId) || null })))
    }

    if (route === '/admin/reviews' && method === 'PATCH') {
      const body = await request.json()
      const review = await db.collection('admin_reviews').findOne({ id: body.id })
      if (!review && String(body.id || '').startsWith('farm-')) {
        const farmId = String(body.id).slice(5)
        const farm = await db.collection('farms').findOne({ id: farmId })
        if (farm) {
          const createdReview = { id: uuidv4(), farmId, reviewType: 'Farm verification', status: 'reviewed', createdAt: new Date(), reviewedAt: new Date() }
          await db.collection('admin_reviews').insertOne(createdReview)
          return ok(createdReview)
        }
      }
      if (!review) return ok({ error: 'Review not found' }, 404)
      review.status = body.status === 'reviewed' ? 'reviewed' : 'open'
      review.reviewedAt = review.status === 'reviewed' ? new Date() : null
      if (db.collection('admin_reviews').updateOne) await db.collection('admin_reviews').updateOne({ id: review.id }, { $set: review })
      return ok(review)
    }

    if (route === '/stress' && method === 'GET') {
      const farmId = searchParams.get('farmId')
      let lat, lon, crop, area, soilPh, nitrogen, state
      if (farmId) {
        const farm = await db.collection('farms').findOne({ id: farmId })
        if (!farm) return ok({ error: 'Farm not found' }, 404)
        lat = farm.latitude
        lon = farm.longitude
        crop = farm.cropType
        area = farm.areaInAcres
        soilPh = farm.soilPh
        nitrogen = farm.nitrogenKgPerHa
        state = farm.state || 'India'
      } else {
        lat = Number(searchParams.get('lat'))
        lon = Number(searchParams.get('lon'))
        crop = searchParams.get('crop') || 'Rice'
        area = Number(searchParams.get('area')) || 5
        soilPh = searchParams.get('ph') ? Number(searchParams.get('ph')) : null
        nitrogen = searchParams.get('n') ? Number(searchParams.get('n')) : null
        state = searchParams.get('state') || 'India'
      }

      const weather = await fetchWeather(lat, lon)
      const diagnostic = computeStressDiagnostic({
        weather, crop, areaInAcres: area, soilPh, nitrogenKgPerHa: nitrogen,
        state,
      })
      diagnostic.economics = computeFarmEconomics({ crop, areaInAcres: area, diagnostic })
      const spray = await fetchSprayWindow(lat, lon, 'Foliar')
      const hydric = await fetchHydricStress(lat, lon, crop)

      const log = {
        id: uuidv4(),
        farmId: farmId || null,
        tmax: weather.tmax,
        tmin: weather.tmin,
        diurnalScore: diagnostic.scores.diurnal,
        nightScore: diagnostic.scores.night,
        frostScore: diagnostic.scores.frost,
        droughtIndex: diagnostic.droughtIndex?.value ?? null,
        recommendedProduct: diagnostic.product.product,
        sprayWindowStart: spray.windows?.[0]?.startTime || null,
        createdAt: new Date(),
      }
      await db.collection('stress_diagnostic_logs').insertOne(log)

      return ok({
        weather,
        diagnostic,
        sprayWindow: spray.windows,
        hydricStress: hydric.data,
        syngentaApi: {
          sprayWindow: spray.ok,
          sprayWindowCount: spray.windows.length,
          sprayWindowStatus: spray.status,
          sprayWindowError: spray.error || null,
          sprayWindowSource: spray.source || null,
          sprayWindowFallback: Boolean(spray.fallback),
          hydricStress: hydric.ok,
        },
        location: { latitude: lat, longitude: lon },
      })
    }

    if (route === '/residue' && method === 'GET') {
      const farmId = searchParams.get('farmId')
      let area, district, cropType
      if (farmId) {
        const farm = await db.collection('farms').findOne({ id: farmId })
        if (!farm) return ok({ error: 'Farm not found' }, 404)
        area = farm.areaInAcres
        district = farm.district
        cropType = farm.cropType
      } else {
        area = Number(searchParams.get('area')) || 5
        district = searchParams.get('district') || 'Patiala'
        cropType = searchParams.get('crop') || 'Rice'
      }
      const metric = await db.collection('district_metrics').findOne({ district })
      const machinery = await db.collection('machinery').find({ district }).limit(100).toArray()
      const districtData = metric
        ? {
            ...getDistrictData(district),
            ...metric,
          }
        : null
      const result = computeResidue({ areaInAcres: area, district, cropType, districtData })
      const [listings, orders] = await Promise.all([
        db.collection('marketplace_listings').find({ status: 'active', category: 'Residue' }).limit(1000).toArray(),
        db.collection('marketplace_orders').find({ farmId: farmId || null, status: { $in: ['new', 'packed', 'out_for_delivery'] } }).limit(1000).toArray(),
      ])
      const bookings = await db.collection('bookings').find({ farmId: farmId || null }).limit(100).toArray()
      const fieldMetrics = computeFieldReadiness({
        areaInAcres: area,
        cropType,
        residueTons: result.residueTons,
        machinery,
        bookings,
        activeListings: listings.length,
        activeOrders: orders.length,
        activeOrderQuantity: orders.reduce((total, order) => total + Math.max(0, Number(order.quantity) || 0), 0),
      })
      return ok({ ...result, ...fieldMetrics })
    }

    if (route === '/machinery' && method === 'GET') {
      const district = searchParams.get('district')
      const type = searchParams.get('type')
      const query = {}
      if (district) query.district = district
      if (type) query.type = type
      const items = await db.collection('machinery').find(query).limit(100).toArray()
      return ok(items.map(({ _id, ...rest }) => rest))
    }

    if (route === '/bookings' && method === 'POST') {
      const body = await request.json()
      const booking = {
        id: uuidv4(),
        farmId: body.farmId || null,
        farmerName: body.farmerName || 'Farmer',
        machineryType: body.machineryType || 'Happy Seeder',
        provider: body.provider || '',
        district: body.district || '',
        date: body.date || new Date().toISOString().slice(0, 10),
        acres: Number(body.acres) || 1,
        status: 'requested',
        createdAt: new Date(),
      }
      await db.collection('bookings').insertOne(booking)
      const { _id, ...clean } = booking
      return ok(clean)
    }

    if (route === '/bookings' && method === 'GET') {
      const farmId = searchParams.get('farmId')
      const query = farmId ? { farmId } : {}
      const items = await db.collection('bookings').find(query).sort({ createdAt: -1 }).limit(100).toArray()
      return ok(items.map(({ _id, ...rest }) => rest))
    }

    if (route === '/district-metrics' && method === 'GET') {
      const district = searchParams.get('district')
      if (district) return ok({ district, ...getDistrictData(district) })
      return ok(Object.entries(DISTRICT_DATA).map(([districtName, values]) => ({ district: districtName, ...values })))
    }

    return ok({ error: `Route ${route} not found` }, 404)
  } catch (error) {
    console.error('API Error:', error)
    return ok({ error: 'Internal server error', detail: String(error?.message || error) }, 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
