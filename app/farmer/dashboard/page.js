'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import React from 'react'
import Link from 'next/link'
import FarmMapCard from '@/components/farmer/FarmMapCard'
import BookMachineryCard from '@/components/farmer/BookMachineryCard'
import LiveKitVoiceAgent from '@/components/farmer/LiveKitVoiceAgent'
import AgroVaniAssistant from '@/components/farmer/AgroVaniAssistant'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { getRecommendationCopy } from '@/lib/i18n/recommendation'
import {
  Wheat, FlaskConical, ArrowLeft, TrendingUp, Sun, Moon, Snowflake,
  Droplets, Sparkles, Clock, Mic, Camera, IndianRupee, AlertTriangle, Loader2,
} from 'lucide-react'

class DebugBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { console.error('Dashboard render error:', err) }
  render() {
    if (this.state.err) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p className="text-lg font-semibold text-slate-900">Something went wrong loading this view.</p>
          <button onClick={() => this.setState({ err: null })} className="pill-dark mt-4">Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

function StressGauge({ label, value, icon: Icon, unit = '/9' }) {
  const v = Number(value) || 0
  const pct = Math.min(100, (v / 9) * 100)
  const color = v > 6 ? '#ef4444' : v > 4 ? '#f59e0b' : v > 2 ? '#eab308' : '#10b981'
  return (
    <div className="rounded-[24px] border border-white/70 bg-white/75 p-5 shadow-[0_12px_28px_rgba(0,0,0,0.04)] backdrop-blur-md">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="mt-3 text-4xl font-bold tracking-tight" style={{ color }}>{v.toFixed(1)}<span className="ml-1 text-base font-medium text-slate-400">{unit}</span></p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function App() {
  const [farms, setFarms] = useState([])
  const [farm, setFarm] = useState(null)
  const [tab, setTab] = useState('crop')
  const [stress, setStress] = useState(null)
  const [residue, setResidue] = useState(null)
  const [machinery, setMachinery] = useState([])
  const [loading, setLoading] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [voiceReply, setVoiceReply] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceMode, setVoiceMode] = useState('idle')
  const [cameraFile, setCameraFile] = useState(null)
  const [cameraPreview, setCameraPreview] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraDiagnosis, setCameraDiagnosis] = useState(null)
  const [cameraLoading, setCameraLoading] = useState(false)
  const recorderRef = useRef(null)
  const voiceChunksRef = useRef([])
  const voiceStreamRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const { locale, t } = useLanguage()
  const copy = t.dashboard
  const recommendationCopy = getRecommendationCopy(locale)

  function localizedProductName(product) {
    if (product === 'No stress product needed') return recommendationCopy.noStress
    if (product === 'Scout before spraying') return recommendationCopy.scout
    return product
  }

  function formatSprayTime(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : locale === 'pa' ? 'pa-IN' : 'en-IN', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(date)
  }

  function stopVoice() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      return
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
    voiceStreamRef.current = null
    setListening(false)
    setVoiceMode('idle')
  }

  async function startVoice() {
    if (listening) {
      stopVoice()
      return
    }

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceText('Voice input needs a secure browser context and microphone support.')
      return
    }

    setVoiceText('Listening... Tap again when you finish your question.')
    setVoiceReply('')
    setVoiceMode('listening')
    setListening(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) || ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      voiceStreamRef.current = stream
      voiceChunksRef.current = []
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => { if (event.data.size > 0) voiceChunksRef.current.push(event.data) }
      recorder.onerror = () => {
        setVoiceText('Voice recording failed. Please try again.')
        stopVoice()
      }
      recorder.onstop = async () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        voiceChunksRef.current = []
        recorderRef.current = null
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        if (!blob.size) {
          setVoiceText('No speech was recorded. Please try again.')
          setListening(false)
          setVoiceMode('idle')
          return
        }
        setListening(false)
        setVoiceMode('thinking')
        setVoiceText('Gemini is understanding your question...')
        const reader = new FileReader()
        reader.onload = async () => {
          try {
            const response = await fetch('/api/assistant/audio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audio: reader.result,
                mimeType: blob.type || 'audio/webm',
                farmId: farm?.id || null,
                locale,
                context: stress || residue || { farm: farm?.cropType || 'Rice' },
              }),
            })
            const data = await response.json()
            if (!response.ok || !data.reply) throw new Error(data.error || 'Gemini voice assistant error')
            setVoiceReply(data.reply)
            setVoiceText('Question answered by Gemini.')
            setVoiceMode('idle')
            if ('speechSynthesis' in window) {
              window.speechSynthesis.cancel()
              window.speechSynthesis.speak(new SpeechSynthesisUtterance(data.reply))
            }
          } catch (error) {
            setVoiceReply(error.message || 'Gemini could not answer right now. Try again.')
            setVoiceMode('idle')
          }
        }
        reader.readAsDataURL(blob)
      }
      recorder.start()
    } catch (error) {
      setVoiceText(error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error.message || 'Unable to start voice recording.')
      setListening(false)
      setVoiceMode('idle')
    }
  }

  function stopCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    setCameraOpen(false)
  }

  async function openCamera() {
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not supported in this browser. Use Upload photo instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      cameraStreamRef.current = stream
      setCameraOpen(true)
    } catch (error) {
      setCameraError(error.name === 'NotAllowedError' ? 'Camera permission was denied. Enable it in browser settings or use Upload photo.' : 'Unable to start the camera. Use Upload photo instead.')
    }
  }

  async function diagnoseCropImage(file) {
    if (!file) return
    setCameraLoading(true)
    setCameraError('')
    setCameraDiagnosis(null)

    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const response = await fetch('/api/crop-diagnose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: reader.result,
              mimeType: file.type || 'image/jpeg',
              cropType: farm?.cropType || 'Rice',
              farmName: farm?.name || 'Farmer',
              location: farm ? `${farm.village || ''}, ${farm.district || ''}`.trim() : '',
            }),
          })
          const data = await response.json()
          if (!response.ok || !data.issue) throw new Error(data.error || 'Crop diagnosis failed')
          setCameraDiagnosis(data)
        } catch (error) {
          setCameraError(error.message || 'Diagnosis failed. Please try another image.')
        } finally {
          setCameraLoading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (error) {
      setCameraError(error.message || 'Unable to read image file.')
      setCameraLoading(false)
    }
  }

  function captureCamera() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(async (blob) => {
      if (blob) {
        const file = new File([blob], `crop-${Date.now()}.jpg`, { type: 'image/jpeg' })
        setCameraFile(file)
        await diagnoseCropImage(file)
      }
      stopCamera()
    }, 'image/jpeg', 0.9)
  }

  useEffect(() => () => stopVoice(), [])
  useEffect(() => () => stopCamera(), [])
  useEffect(() => {
    if (!cameraFile) {
      setCameraPreview('')
      return undefined
    }
    const previewUrl = URL.createObjectURL(cameraFile)
    setCameraPreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [cameraFile])

  useEffect(() => {
    if (cameraOpen && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current
    }
  }, [cameraOpen])

  useEffect(() => {
    const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null
    if (p === 'crop') setTab('crop')
    if (p === 'residue') setTab('residue')

    async function loadFarms() {
      try {
        let res = await fetch('/api/farms')
        let list = await res.json()
        if (!res.ok || !Array.isArray(list)) throw new Error(list.error || 'Unable to load farms')
        const farmsArr = Array.isArray(list) ? list : []
        setFarms(farmsArr)
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('fv_farmId') : null
        const initial = farmsArr.find((f) => f.id === savedId) || farmsArr[0] || null
        setFarm(initial)
      } catch (e) {
        console.error('Farm loading failed:', e)
        setFarms([])
      }
    }
    loadFarms()
  }, [])

  const loadData = useCallback((f) => {
    if (!f) return
    setLoading(true)
    setStress(null)
    setResidue(null)
    fetch(`/api/residue?farmId=${f.id}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || data.error) throw new Error(data.error || 'Residue data unavailable')
        return data
      })
      .then(setResidue)
      .catch((error) => console.error('Residue loading failed:', error))
    fetch(`/api/machinery?district=${encodeURIComponent(f.district || '')}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !Array.isArray(data)) throw new Error(data.error || 'Machinery data unavailable')
        return data
      })
      .then(setMachinery)
      .catch((error) => {
        console.error('Machinery loading failed:', error)
        setMachinery([])
      })
    fetch(`/api/stress?farmId=${f.id}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || data.error) throw new Error(data.error || 'Stress data unavailable')
        return data
      })
      .then(setStress)
      .catch((error) => console.error('Stress loading failed:', error))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (farm) loadData(farm) }, [farm, loadData])

  const diag = stress?.diagnostic
  const sprayWindows = stress?.sprayWindow || []
  const syngentaApi = stress?.syngentaApi

  return (
    <DebugBoundary>
      <main className="page-farmer min-h-screen p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" /> AgroVani
            </Link>
            <LanguageSwitcher />

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="inline-flex rounded-full border border-white/80 bg-white/70 p-1 shadow-[0_8px_20px_rgba(0,0,0,0.05)] backdrop-blur-md">
                  <button onClick={() => setTab('residue')} className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${tab === 'residue' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                  <Wheat className="h-4 w-4" /> {copy.residueTab}
                </button>
                <button onClick={() => setTab('crop')} className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${tab === 'crop' ? 'bg-[#006a42] text-white shadow-md shadow-emerald-600/20' : 'text-slate-600 hover:text-slate-900'}`}>
                  <FlaskConical className="h-4 w-4" /> {copy.cropTab}
                </button>
              </div>

              <div className="flex items-center gap-3 rounded-full border border-white/80 bg-white/70 px-4 py-2 shadow-[0_8px_20px_rgba(0,0,0,0.04)] backdrop-blur-md">
                <span className="text-sm font-medium text-slate-600">{copy.farm}:</span>
                <select
                  className="bg-transparent text-sm font-semibold text-slate-900 focus:outline-none"
                  value={farm?.id || ''}
                  onChange={(e) => setFarm(farms.find((f) => f.id === e.target.value))}
                >
                  {farms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} • {f.village} ({f.cropType})</option>
                  ))}
                </select>
              </div>
            </div>
          </header>

          {loading && (
            <div className="mb-6 flex items-center gap-2 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur-md">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching live weather & agronomic data…
            </div>
          )}

          {tab === 'residue' && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="glass-card card-3d">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">{copy.residueForecast}</p>
                <p className="mt-4 text-5xl font-bold tracking-tight text-slate-900">{residue ? (residue.residueTons / (farm?.areaInAcres || 1)).toFixed(1) : '—'} <span className="text-lg font-medium text-slate-500">t/acre</span></p>
                <p className="mt-3 text-sm text-slate-600">{residue?.residueTons ?? '—'} tons total across {farm?.areaInAcres ?? '—'} acres</p>
              </div>

              <div className="glass-card card-3d">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">{copy.buyerDemand}</p>
                <p className="mt-4 text-5xl font-bold tracking-tight text-emerald-600">{residue?.buyerDemand || '—'}</p>
                <p className="mt-3 flex items-center gap-1 text-sm text-slate-600"><IndianRupee className="h-4 w-4" /> {residue?.totalValueINR?.toLocaleString('en-IN') ?? '—'} potential value</p>
                <BookMachineryCard farm={farm} defaultType="Baler" triggerLabel="Sell Stubble" triggerClass="pill-dark mt-4 w-full" />
              </div>

              <div className="glass-card card-3d">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">{copy.machineryReadiness}</p>
                <p className="mt-4 text-5xl font-bold tracking-tight text-slate-900">{residue?.machineryReadiness ?? '—'}<span className="text-2xl font-medium text-slate-500">%</span></p>
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                  <AlertTriangle className={`h-4 w-4 ${residue?.riskLevel === 'High' ? 'text-red-500' : 'text-amber-500'}`} />
                  Stubble risk: <span className="font-semibold">{residue?.riskLevel || '—'}</span> • {residue?.hotspots ?? 0} hotspots
                </div>
              </div>

              <div className="lg:col-span-2">
                <FarmMapCard lat={farm?.latitude} lon={farm?.longitude} mode="residue" title="Residue & Machinery Map" />
              </div>

              <div className="glass-card card-3d flex flex-col">
                <h3 className="text-xl font-semibold text-slate-900">Equipment</h3>
                <p className="mt-2 text-sm text-slate-600">Nearby custom hiring centers</p>
                <ul className="mt-4 space-y-3 text-sm text-slate-700">
                  {machinery.slice(0, 4).map((item) => (
                    <li key={item.id || `${item.type}-${item.provider}`} className="flex items-center justify-between rounded-2xl bg-white/60 px-4 py-3">
                      <span>{item.type}<span className="ml-2 text-xs text-slate-500">{item.provider}</span></span>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.available === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>{item.available === false ? 'Unavailable' : 'Available'}</span>
                    </li>
                  ))}
                  {!machinery.length && <li className="rounded-2xl bg-white/60 px-4 py-3 text-slate-500">No machinery records found for this district.</li>}
                </ul>
                <div className="mt-auto pt-4">
                  <BookMachineryCard farm={farm} defaultType="Happy Seeder" triggerLabel="Request Equipment" triggerClass="pill-dark w-full" />
                </div>
              </div>
            </div>
          )}

          {tab === 'crop' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-4 rounded-[28px] bg-gradient-to-r from-[#006a42] to-[#29a56b] px-6 py-5 text-white shadow-[0_20px_45px_rgba(0,106,66,0.25)]">
                <TrendingUp className="h-6 w-6" />
                <p className="text-lg font-semibold">{copy.roi}: {diag?.economics?.roiPercent != null ? `${diag.economics.roiPercent}%` : '—'}</p>
                <span className="hidden h-6 w-px bg-white/40 sm:block" />
                <p className="text-lg font-semibold">{copy.grossReturn}: ₹{diag?.economics?.netReturn?.toLocaleString('en-IN') || '—'}</p>
                <span className="ml-auto rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">Causal ROI attribution</span>
              </div>

              <div className="glass-card">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <h3 className="text-xl font-semibold text-slate-900">{copy.liveStress} — {farm?.cropType}</h3>
                  {diag && <span className="text-sm text-slate-500">TMAX {diag.tmax?.toFixed(1)}°C • TMIN {diag.tmin?.toFixed(1)}°C</span>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StressGauge label={t.diurnalHeat} value={diag?.scores?.diurnal} icon={Sun} />
                  <StressGauge label={t.nightHeat} value={diag?.scores?.night} icon={Moon} />
                  <StressGauge label={t.frost} value={diag?.scores?.frost} icon={Snowflake} />
                  <div className="rounded-[24px] border border-white/70 bg-white/75 p-5 shadow-[0_12px_28px_rgba(0,0,0,0.04)] backdrop-blur-md">
                    <div className="flex items-center gap-2 text-slate-500"><Droplets className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-[0.2em]">{copy.droughtIndex}</span></div>
                    <p className="mt-3 text-4xl font-bold text-slate-900">{diag?.droughtIndex?.value?.toFixed(2) ?? '—'}</p>
                    <p className="mt-3 text-sm font-medium" style={{ color: diag?.droughtIndex?.risk === 'High Risk' ? '#ef4444' : diag?.droughtIndex?.risk === 'Medium Risk' ? '#f59e0b' : '#10b981' }}>{diag?.droughtIndex?.risk || '—'}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <div className="glass-card card-3d lg:col-span-2">
                  <div className="flex items-center gap-2 text-emerald-600"><Sparkles className="h-5 w-5" /><span className="text-[10px] font-bold uppercase tracking-[0.28em]">{copy.recommendationTitle}</span></div>
                  {diag ? (
                    <>
                      <h3 className="mt-4 text-2xl font-bold text-slate-900">{localizedProductName(diag.product.product)}</h3>
                      <p className="text-sm font-semibold text-emerald-700">{recommendationCopy.brands[diag.product.category] || diag.product.brand}</p>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{recommendationCopy.rationale[diag.product.category] || diag.product.rationale}</p>
                      {diag.product.requiresConfirmation && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900">{copy.confirmLabel}</p>}
                      {diag.product.options?.length > 0 && (
                        <div className="mt-5 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">{copy.options}</p>
                          {diag.product.options.map((option) => (
                            <div key={option.name} className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2">
                              <p className="text-sm font-semibold text-emerald-900">{option.name} <span className="font-normal text-emerald-700">· {recommendationCopy.products[option.name]?.type || option.type}</span></p>
                              {option.composition && <p className="mt-1 text-xs font-medium text-emerald-700">{recommendationCopy.products[option.name]?.composition || option.composition}</p>}
                              <p className="mt-1 text-xs leading-5 text-emerald-800">{recommendationCopy.products[option.name]?.use || option.use}</p>
                              {option.dosage && <p className="mt-1 text-[11px] font-semibold leading-4 text-amber-800">{copy.dosage}: {option.dosage.rateMlPerLitre} {recommendationCopy.mlPerLitre} · {option.dosage.waterLitres} L {recommendationCopy.water} · {option.dosage.productMl} ml {recommendationCopy.product} · {option.dosage.applicationsPerDay} {copy.timesPerDay} · {option.dosage.applicationsPerSeason} {copy.applications}</p>}
                              {option.dosage && <p className="mt-1 text-[11px] leading-4 text-emerald-800">{copy.region}: {recommendationCopy.regions[option.dosage.region] || option.dosage.region} · {copy.interval}: {option.dosage.intervalDays} {recommendationCopy.days} · {recommendationCopy.timing[option.name] || option.dosage.timing}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      {diag.product.options?.length > 0 ? (
                        <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-white">
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-slate-300"><FlaskConical className="h-4 w-4" /> {copy.fieldPlan}</div>
                          <p className="mt-3 text-sm text-slate-200">{copy.fieldPlanText(diag.dosing.acres, recommendationCopy.regions[diag.dosing.region] || diag.dosing.region)}</p>
                        </div>
                      ) : (
                        <div className="mt-5 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">{copy.noProduct}</div>
                      )}
                    </>
                  ) : <p className="mt-4 text-sm text-slate-500">Computing recommendation…</p>}
                </div>

                <div className="glass-card card-3d">
                  <div className="flex items-center gap-2 text-slate-500"><Clock className="h-5 w-5" /><span className="text-[10px] font-bold uppercase tracking-[0.28em]">{copy.sprayWindow}</span></div>
                  <p className="mt-2 text-xs text-slate-400">{copy.sprayProvider}: {syngentaApi?.sprayWindowSource || '—'}</p>
                  {syngentaApi && <p className="mt-1 text-xs text-slate-500">{copy.liveApi}: {syngentaApi.sprayWindow ? copy.connected : copy.unavailable} · {copy.spraySource}: {syngentaApi.sprayWindowSource || '—'}</p>}
                  {sprayWindows.length > 0 ? (
                    <ul className="mt-4 space-y-2 text-sm text-emerald-800">
                      {sprayWindows.slice(0, 4).map((w, i) => (
                        <li key={i} className="rounded-xl bg-emerald-50 px-3 py-2">
                          <p className="font-semibold">{formatSprayTime(w.startTime || w.date)} {w.endTime ? `→ ${formatSprayTime(w.endTime)}` : ''}</p>
                          {(w.temperatureC != null || w.rainChancePercent != null || w.windKph != null) && <p className="mt-1 text-xs">{copy.temperature}: {w.temperatureC ?? '—'}°C · {copy.rainChance}: {w.rainChancePercent ?? '—'}% · {copy.wind}: {w.windKph ?? '—'} km/h · {copy.humidity}: {w.humidityPercent ?? '—'}%</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                      {syngentaApi?.sprayWindow ? copy.noWindow : `${copy.sprayUnavailable}${syngentaApi?.sprayWindowError ? `: ${syngentaApi.sprayWindowError}` : ''}`}
                    </div>
                  )}
                  <BookMachineryCard farm={farm} defaultType="Boom Sprayer" triggerLabel="Book Sprayer Machine" triggerClass="pill-dark mt-4 w-full" />
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="glass-card">
                  <div className="flex items-center gap-2 text-slate-900"><Mic className="h-5 w-5 text-emerald-600" /><h3 className="text-xl font-semibold">Live Voice Advisory</h3></div>
                  <p className="mt-2 text-sm text-slate-600">Talk naturally with the Gemini Live agent in Punjabi, Hindi, Marathi, Tamil, Telugu, or English.</p>
                  <LiveKitVoiceAgent />
                </div>

                <div className="glass-card">
                  <div className="flex items-center gap-2 text-slate-900"><Camera className="h-5 w-5 text-emerald-600" /><h3 className="text-xl font-semibold">Crop Cam Diagnostic</h3></div>
                  <p className="mt-2 text-sm text-slate-600">Snap a leaf to detect chlorosis, heat wilting & fungal lesions with Gemini Vision.</p>
                  {cameraOpen ? (
                    <div className="mt-5 overflow-hidden rounded-2xl border border-emerald-200 bg-slate-950">
                      <video ref={videoRef} autoPlay playsInline muted className="h-48 w-full object-cover" />
                      <div className="flex gap-3 p-3">
                        <button type="button" onClick={captureCamera} className="pill-dark flex-1">Capture photo</button>
                        <button type="button" onClick={stopCamera} className="glass-btn flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20">Cancel</button>
                      </div>
                    </div>
                  ) : cameraPreview ? (
                    <img src={cameraPreview} alt="Captured crop leaf" className="mt-5 h-48 w-full rounded-2xl object-cover" />
                  ) : (
                    <div className="mt-5 flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 text-sm font-medium text-slate-500">No crop photo selected</div>
                  )}
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={openCamera} className="pill-dark"><Camera className="mr-2 h-4 w-4" /> Open camera</button>
                    <label className="glass-btn cursor-pointer"><span>Upload photo</span><input type="file" accept="image/*" className="sr-only" onChange={(event) => {
                      const file = event.target.files?.[0] || null
                      setCameraFile(file)
                      if (file) diagnoseCropImage(file)
                    }} /></label>
                  </div>
                  {cameraLoading && <p className="mt-3 text-xs font-medium text-emerald-700">Diagnosing crop image with Gemini…</p>}
                  {cameraError && <p role="alert" className="mt-3 text-xs font-medium text-red-600">{cameraError}</p>}
                  {cameraDiagnosis && (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Diagnosis</p>
                      <p className="mt-2 text-lg font-semibold">{cameraDiagnosis.issue}</p>
                      <p className="mt-1">Severity: <span className="font-semibold">{cameraDiagnosis.severity}</span> · Confidence: <span className="font-semibold">{Number(cameraDiagnosis.confidence || 0).toFixed(2)}</span></p>
                      <p className="mt-2 text-sm text-emerald-800">{cameraDiagnosis.recommendation || cameraDiagnosis.mappedRecommendation?.recommendation}</p>
                      {cameraDiagnosis.product && <p className="mt-2"><span className="font-semibold">Recommended product:</span> {cameraDiagnosis.product}</p>}
                      {cameraDiagnosis.dosageGuidance && <p className="mt-2 border-t border-emerald-200 pt-2 text-xs leading-5 text-emerald-800"><span className="font-semibold">Label-safe application:</span> {cameraDiagnosis.dosageGuidance}</p>}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500">{cameraFile ? 'Leaf image ready for diagnosis.' : 'Use the camera or upload a leaf photo to prepare a crop diagnosis.'}</p>
                </div>

                <AgroVaniAssistant farmId={farm?.id} context={{ stress, residue }} />
              </div>

              <FarmMapCard lat={farm?.latitude} lon={farm?.longitude} mode="crop" stressScore={Math.max(diag?.scores?.diurnal || 0, diag?.scores?.night || 0)} title="Crop Health & Stress Map" />
            </div>
          )}
        </div>
      </main>
    </DebugBoundary>
  )
}
