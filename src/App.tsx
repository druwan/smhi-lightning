import { useState, useMemo, useRef } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'
import { CalendarIcon, Download, LocateFixed, Loader2, Search, X, Zap } from 'lucide-react'

import { searchStrikes, summariseByDay, toCSV } from './lightning'
import type { Progress as SearchProgress, Query, Strike } from './lightning'
import { Alert, AlertDescription, AlertTitle } from '@//components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HELP, HelpHint } from './components/help-hint'

const MAX_DAYS = 366
const MAX_TABLE_ROWS = 500
const ARCHIVE_START = new Date(2012, 0, 1)

/** Local calendar date -> YYYY-MM-DD (the picker returns local midnight). */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const fmtTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 23)

export default function App() {
  const [coords, setCoords] = useState({ lat: '59.3293', lon: '18.0686', radiusNm: '5' })
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 7, 1),
    to: new Date(2026, 8, 31),
  })
  const [strikes, setStrikes] = useState<Strike[] | null>(null)
  const [lastQuery, setLastQuery] = useState<Query | null>(null)
  const [progress, setProgress] = useState<SearchProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cgOnly, setCgOnly] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const loading = progress !== null

  const shown = useMemo(
    () => (strikes && cgOnly ? strikes.filter((s) => s.cloudToGround) : strikes),
    [strikes, cgOnly],
  )
  const days = useMemo(() => (shown ? summariseByDay(shown) : []), [shown])
  const cgCount = useMemo(() => shown?.filter((s) => s.cloudToGround).length ?? 0, [shown])
  const closest = useMemo(
    () => (shown?.length ? shown.reduce((m, s) => Math.min(m, s.distanceNm), Infinity) : null),
    [shown],
  )

  const set = (key: keyof typeof coords) => (e: ChangeEvent<HTMLInputElement>) =>
    setCoords((c) => ({ ...c, [key]: e.target.value }))

  function locateMe() {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setCoords((c) => ({
          ...c,
          lat: pos.coords.latitude.toFixed(4),
          lon: pos.coords.longitude.toFixed(4),
        })),
      (err) => setError(`Could not get your location: ${err.message}`),
    )
  }

  function validate(): Query | string {
    const lat = Number(coords.lat)
    const lon = Number(coords.lon)
    const radiusNm = Number(coords.radiusNm)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.'
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'Longitude must be between -180 and 180.'
    if (!(radiusNm > 0)) return 'Radius must be greater than 0.'
    if (!range?.from) return 'Pick a date range.'
    const start = ymd(range.from)
    const end = ymd(range.to ?? range.from)
    const span = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1
    if (span > MAX_DAYS) return `Max ${MAX_DAYS} days per search (each day is a separate download).`
    return { lat, lon, radiusNm, start, end }
  }

  async function onSubmit(e: ChangeEvent) {
    e.preventDefault()
    const q = validate()
    if (typeof q === 'string') {
      setError(q)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    setStrikes(null)

    try {
      const result = await searchStrikes(q, { signal: ctrl.signal, onProgress: setProgress })
      setStrikes(result)
      setLastQuery(q)
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setProgress(null)
    }
  }

  function cancel() {
    abortRef.current?.abort()
    abortRef.current = null
    setProgress(null)
  }

  function download() {
    if (!shown || !lastQuery) return
    const q = lastQuery
    const blob = new Blob([toCSV(shown)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lightning_${q.lat}_${q.lon}_${q.radiusNm}nm_${q.start}_${q.end}${cgOnly ? '_cg' : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rangeLabel = range?.from
    ? range.to
      ? `${ymd(range.from)} → ${ymd(range.to)}`
      : ymd(range.from)
    : 'Pick dates'

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <Zap className="size-7" /> Lightning history
        </h1>
        <p className="text-muted-foreground">
          Historical lightning from the{' '}
          <a
            className="underline underline-offset-4"
            href="https://opendata.smhi.se/lightning/archive/introduction"
            target="_blank"
            rel="noreferrer"
          >
            SMHI open data archive
          </a>
          . Data is fetched directly by your browser. All times are UTC.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>A point, a radius in nautical miles, and a date range.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="lat">Latitude</Label>
              <Input id="lat" inputMode="decimal" value={coords.lat} onChange={set('lat')} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lon">Longitude</Label>
              <div className="flex gap-2">
                <Input id="lon" inputMode="decimal" value={coords.lon} onChange={set('lon')} required />
                <Button type="button" variant="outline" size="icon" onClick={locateMe} title="Use my location">
                  <LocateFixed />
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="radius">Radius (NM)</Label>
              <Input id="radius" inputMode="decimal" value={coords.radiusNm} onChange={set('radiusNm')} required />
            </div>
            <div className="grid gap-2">
              <Label>Date range (UTC)</Label>
              <Popover>
                <PopoverTrigger
                  render={<Button type="button" variant="outline" className="justify-start font-normal" />}
                >
                  <CalendarIcon />
                  {rangeLabel}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={range}
                    onSelect={setRange}
                    numberOfMonths={2}
                    defaultMonth={range?.from}
                    captionLayout="dropdown"
                    startMonth={ARCHIVE_START}
                    endMonth={new Date()}
                    disabled={{ after: new Date() }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                {loading ? 'Searching…' : 'Search'}
              </Button>
              {loading && (
                <Button type="button" variant="outline" onClick={cancel}>
                  <X /> Cancel
                </Button>
              )}
            </div>
          </form>

          {progress && (
            <div className="mt-4 flex items-center gap-3">
              <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
              <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                {progress.done} / {progress.total} days
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {
        error && (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )
      }

      {
        shown && (
          <section className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Strikes" value={shown.length} />
              <Stat label="Days with lightning" value={days.length} />
              <Stat label={<HelpHint label="Cloud-to-ground">{HELP.cloudToGround}</HelpHint>} value={cgCount} />
              <Stat label="Closest" value={closest === null ? '–' : `${closest.toFixed(2)} NM`} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Switch id="cg-only" checked={cgOnly} onCheckedChange={setCgOnly} />
                <Label htmlFor="cg-only">Cloud-to-ground only</Label>
              </div>
              <Button variant="outline" onClick={download} disabled={shown.length === 0}>
                <Download /> Download CSV
              </Button>
            </div>

            {shown.length === 0 ? (
              <p className="text-muted-foreground">No strikes found for this search.</p>
            ) : (
              <Tabs defaultValue="days">
                <TabsList>
                  <TabsTrigger value="days">Per day</TabsTrigger>
                  <TabsTrigger value="strikes">Strikes</TabsTrigger>
                </TabsList>

                <TabsContent value="days">
                  <Card>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Strikes</TableHead>
                            <TableHead className="text-right"><HelpHint label="Cloud to ground">{HELP.cloudToGround}</HelpHint></TableHead>
                            <TableHead className="text-right">Closest (NM)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {days.map((d) => (
                            <TableRow key={d.date}>
                              <TableCell>{d.date}</TableCell>
                              <TableCell className="text-right tabular-nums">{d.strikes}</TableCell>
                              <TableCell className="text-right tabular-nums">{d.cloudToGround}</TableCell>
                              <TableCell className="text-right tabular-nums">{d.closestNm.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="strikes">
                  <Card>
                    <CardContent className="space-y-2">
                      {shown.length > MAX_TABLE_ROWS && (
                        <p className="text-muted-foreground text-sm">
                          Showing the first {MAX_TABLE_ROWS} of {shown.length}. Download the CSV for all.
                        </p>
                      )}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Time (UTC)</TableHead>
                            <TableHead className="text-right">Lat</TableHead>
                            <TableHead className="text-right">Lon</TableHead>
                            <TableHead className="text-right">Dist (NM)</TableHead>
                            <TableHead className="text-right">
                              <HelpHint label="Peak (kA)">{HELP.peakCurrent}</HelpHint>
                            </TableHead>
                            <TableHead>
                              <HelpHint label="Type">{HELP.type}</HelpHint>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {shown.slice(0, MAX_TABLE_ROWS).map((s, i) => (
                            <TableRow key={i}>
                              <TableCell className="tabular-nums">{fmtTime(s.time)}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.lat.toFixed(4)}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.lon.toFixed(4)}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.distanceNm.toFixed(2)}</TableCell>
                              <TableCell className="text-right tabular-nums">{s.peakCurrent}</TableCell>
                              <TableCell>
                                <Badge variant={s.cloudToGround ? 'default' : 'secondary'}>
                                  {s.cloudToGround ? 'Ground' : 'Cloud'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </section>
        )
      }
    </main >
  )
}

function Stat({ label, value }: { label: ReactNode; value: number | string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
