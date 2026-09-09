'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Download, Loader2, Mic, Send, Square, Volume2, VolumeX } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const speechLocales = { en: 'en-IN', hi: 'hi-IN', pa: 'pa-IN' }

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function AgroVaniAssistant({ farmId = null, context = null, compact = false }) {
  const { locale } = useLanguage()
  const [messages, setMessages] = useState([
    { id: makeId(), role: 'assistant', text: 'Namaste. I am AgroVani. Ask me about your crop, weather, residue, or field decisions.' },
  ])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [installEvent, setInstallEvent] = useState(null)
  const recognitionRef = useRef(null)
  const endRef = useRef(null)

  useEffect(() => {
    const onInstall = (event) => {
      event.preventDefault()
      setInstallEvent(event)
    }
    window.addEventListener('beforeinstallprompt', onInstall)
    return () => window.removeEventListener('beforeinstallprompt', onInstall)
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  function speak(text) {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = speechLocales[locale] || 'en-IN'
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setMessages((current) => [...current, { id: makeId(), role: 'assistant', text: 'Voice input is not supported in this browser. You can still type your question.' }])
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = speechLocales[locale] || 'en-IN'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onstart = () => setListening(true)
    recognition.onresult = (event) => setDraft(event.results[0][0].transcript)
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
  }

  async function sendMessage(event) {
    event?.preventDefault()
    const message = draft.trim()
    if (!message || busy) return
    setDraft('')
    setMessages((current) => [...current, { id: makeId(), role: 'user', text: message }])
    setBusy(true)
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, farmId, locale, context }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.reply) throw new Error(data.error || 'AgroVani could not answer right now.')
      setMessages((current) => [...current, { id: makeId(), role: 'assistant', text: data.reply }])
      speak(data.reply)
    } catch (error) {
      setMessages((current) => [...current, { id: makeId(), role: 'assistant', error: true, text: error.message }])
    } finally {
      setBusy(false)
    }
  }

  async function installApp() {
    if (!installEvent) return
    installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  return (
    <section className={`assistant-shell ${compact ? 'assistant-shell-compact' : ''}`} aria-label="AgroVani AI assistant">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="assistant-mark"><Bot className="h-5 w-5" /></div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">AgroVani AI</p>
            <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Voice and text ready</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {installEvent && <button type="button" onClick={installApp} className="assistant-icon-button" title="Install AgroVani"><Download className="h-4 w-4" /></button>}
          <button type="button" onClick={() => { window.speechSynthesis?.cancel(); setSpeaking(false) }} className="assistant-icon-button" title={speaking ? 'Stop speaking' : 'Voice replies'}>
            {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="assistant-messages" aria-live="polite">
        {messages.map((item) => (
          <div key={item.id} className={`assistant-message ${item.role === 'user' ? 'assistant-message-user' : 'assistant-message-ai'} ${item.error ? 'assistant-message-error' : ''}`}>
            {item.text}
            {item.role === 'assistant' && !item.error && <button type="button" className="ml-2 inline-flex align-middle text-emerald-700" title="Read aloud" onClick={() => speak(item.text)}><Volume2 className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
        {busy && <div className="assistant-message assistant-message-ai"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Thinking through your field context...</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={sendMessage} className="assistant-composer">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask AgroVani anything..." aria-label="Ask AgroVani" />
        <button type="button" onClick={toggleListening} className={`assistant-icon-button ${listening ? 'assistant-icon-button-active' : ''}`} title={listening ? 'Stop listening' : 'Ask by voice'}>
          {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button type="submit" disabled={busy || !draft.trim()} className="assistant-send" title="Send question"><Send className="h-4 w-4" /></button>
      </form>
      <div className="flex items-center justify-between px-4 pb-3 pt-1 text-[10px] font-medium text-slate-400">
        <span>AgroVani can make mistakes. Verify high-risk decisions locally.</span>
        {installEvent && <button type="button" onClick={installApp} className="flex items-center gap-1 font-bold text-emerald-700"><Check className="h-3 w-3" /> Install app</button>}
      </div>
    </section>
  )
}