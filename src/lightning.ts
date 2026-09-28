// SMHI lightning archive
// Docs: https://opendata.smhi.se/lightning/archive/introduction
// One CSV/day covering SMHI's whole area; then filter client side

const BASE = 'https://opendata-download-lightning.smhi.se/api/version/latest'
const EARTH_RADIUS_NM = 3440.065
const NM_PER_DEG_LAT = 60

export interface Strike {
  time: Date,
  lat: number,
  lon: number,
  distanceNm: number,
  peakCurrent: number // kA, sign = polarity
  cloudToGround: boolean, // cloudIndicator === 0
  errorKm: number // semiMajorAxis of a location error ellipse
}

export interface Query {
  lat: number,
  lon: number,
  radiusNm: number,
  start: string, // YYYY-MM-DD
  end: string // YYYY-MM-DD
}

export interface Progress {
  done: number,
  total: number
}

const toRad = (deg: number) => (deg * Math.PI) / 180

export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lon2 - lon1)
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a))
}

// All UTC days from start to end inclusive as Date obj
export function daysBetween(start: string, end: string): Date[] {
  const days: Date[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last) {
    days.push(new Date(d))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

// Raw CSV text per day
const dayCache = new Map<string, string>()

async function fetchDayCSV(day: Date, signal?: AbortSignal): Promise<string> {
  const y = day.getUTCFullYear()
  const m = day.getUTCMonth() + 1
  const d = day.getUTCDate()
  const key = `${y}-${m}-${d}`
  const cached = dayCache.get(key)
  if (cached !== undefined) return cached

  const res = await fetch(`${BASE}/year/${y}/month/${m}/day/${d}/data.csv`, { signal })
  if (res.status === 404) return ''
  if (!res.ok) throw new Error(`SMHI returned ${res.status} for ${key}`)
  const text = await res.text()

  // Don't cache last 2 days
  if (Date.now() - day.getTime() > 2 * 8640000) dayCache.set(key, text)
  return text
}

function filterCSV(text: string, q: Query): Strike[] {
  const lines = text.split('\n')
  if (lines.length < 2) return []

  const header = lines[0].trim().split(';')
  const col = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`Unexpected CSV format: missing col "${name}"`)
    return i
  }
  const iY = col('year'), iMo = col('month'), iD = col('day')
  const iH = col('hours'), iMi = col('minutes'), iS = col('seconds'), iNs = col('nanoseconds')
  const iLat = col('lat'), iLon = col('lon'), iPeak = col('peakCurrent')
  const iCloud = col('cloudIndicator'), iErr = col('semiMajorAxis')

  // rough estimate of bounding box
  const dLat = q.radiusNm / NM_PER_DEG_LAT
  const dLon = q.radiusNm / (NM_PER_DEG_LAT * Math.max(Math.cos(toRad(q.lat)), 0.01))

  const out: Strike[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const f = line.split(';')
    const lat = +f[iLat]
    const lon = +f[iLon]
    if (Math.abs(lat - q.lat) > dLat || Math.abs(lon - q.lon) > dLon) continue

    const dist = distanceNm(q.lat, q.lon, lat, lon)
    if (dist > q.radiusNm) continue

    out.push({
      time: new Date(
        Date.UTC(+f[iY], +f[iMo] - 1, +f[iD], +f[iH], +f[iMi], +f[iS], Math.floor(+f[iNs] / 1e6)),
      ),
      lat,
      lon,
      distanceNm: dist,
      peakCurrent: +f[iPeak],
      cloudToGround: f[iCloud] === '0',
      errorKm: +f[iErr],
    })
  }
  return out
}

export async function searchStrikes(
  q: Query,
  opts: { concurrency?: number, signal?: AbortSignal; onProgress?: (p: Progress) => void } = {},
): Promise<Strike[]> {
  const { concurrency = 6, signal, onProgress } = opts
  const days = daysBetween(q.start, q.end)
  const results: Strike[][] = new Array(days.length)
  let next = 0
  let done = 0
  onProgress?.({ done, total: days.length })

  const worker = async () => {
    while (next < days.length) {
      const idx = next++
      const text = await fetchDayCSV(days[idx], signal)
      results[idx] = filterCSV(text, q)
      onProgress?.({ done: ++done, total: days.length })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, days.length) }, worker))
  return results.flat().sort((a, b) => a.time.getTime() - b.time.getTime())
}

export interface DaySummary {
  date: string,
  strikes: number,
  cloudToGround: number,
  closestNm: number
}

export function summariseByDay(strikes: Strike[]): DaySummary[] {
  const byDay = new Map<string, DaySummary>()
  for (const s of strikes) {
    const date = s.time.toISOString().slice(0, 10)
    const row = byDay.get(date) ?? { date, strikes: 0, cloudToGround: 0, closestNm: Infinity }
    row.strikes++
    if (s.cloudToGround) row.cloudToGround++
    row.closestNm = Math.min(row.closestNm, s.distanceNm)
    byDay.set(date, row)
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function toCSV(strikes: Strike[]): string {
  const header = 'time_utc,lat,lon,distance_nm,peak_current_ka,cloud_to_ground,error_km'
  const rows = strikes.map((s) =>
    [
      s.time.toISOString(),
      s.lat,
      s.lon,
      s.distanceNm.toFixed(3),
      s.peakCurrent,
      s.cloudToGround ? 1 : 0,
      s.errorKm,
    ].join(','),
  )
  return [header, ...rows].join('\n')
}
