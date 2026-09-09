'use client'

import Link from 'next/link'
import { Wind, Droplet, Leaf, ArrowRight, Sparkles } from 'lucide-react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import AgroVaniAssistant from '@/components/farmer/AgroVaniAssistant'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const impactCards = [
  { title: 'Reduce stubble burning', description: 'Protect air quality with residue alternatives and local machinery support.', icon: Wind },
  { title: 'Beat abiotic stress', description: 'Live heat, frost and drought scores drive precise biostimulant decisions.', icon: Droplet },
  { title: 'Create residue income', description: 'Find buyers and processing plants for stubble off-take and steady income.', icon: Leaf },
]

export default function App() {
  const { t } = useLanguage()
  const location = 'India'

  return (
    <main className="page-home bg-image min-h-screen text-white">
      <nav className="sticky top-0 z-50 border-b border-white/20 bg-slate-950/35 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-lg text-white shadow-sm shadow-emerald-600/25">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight text-white">{t.brand}</p>
            </div>
          </div>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#" className="text-sm font-medium text-slate-200 transition hover:text-white">{t.nav.residue}</a>
            <a href="#" className="text-sm font-medium text-slate-200 transition hover:text-white">{t.nav.machinery}</a>
            <a href="#" className="text-sm font-medium text-slate-200 transition hover:text-white">{t.nav.crop}</a>
            <a href="#" className="text-sm font-medium text-slate-200 transition hover:text-white">{t.nav.advisory}</a>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
          </div>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_0.95fr] lg:items-center lg:px-8 lg:py-24">
        <div className="z-10 flex flex-col gap-8">
          <div className="inline-flex w-max items-center gap-2 rounded-full border border-white/70 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 shadow-[0_4px_12px_rgba(0,0,0,0.04)] backdrop-blur-md">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
            {t.heroBadge}
          </div>

          <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-[-0.05em] text-slate-950 sm:text-6xl">
            {t.heroTitle(location)}
          </h1>

          <p className="max-w-xl text-lg leading-8 text-slate-700">
            {t.heroSubtitle}
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link href="/login" className="pill-dark">
              Get started <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link href="/farmer/dashboard" className="pill-outline">
              Explore the demo dashboard
            </Link>
          </div>

          <AgroVaniAssistant compact />

          <div className="grid gap-4 pt-8 sm:grid-cols-3">
            {impactCards.map((card) => {
              const Icon = card.icon
              return (
                <div key={card.title} className="glass-card card-3d">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-emerald-600 shadow-inner">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 text-[18px] font-semibold leading-6 text-slate-950">{card.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="relative mt-8 lg:mt-0">
          <div className="glass-card relative overflow-hidden p-4 md:p-6">
            <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-emerald-200/40 blur-3xl" />
            <div className="absolute -bottom-16 -left-16 h-52 w-52 rounded-full bg-sky-200/40 blur-3xl" />

            <div className="relative overflow-hidden rounded-[24px] border border-white/60 shadow-[inset_0_2px_8px_rgba(0,0,0,0.08),0_12px_30px_rgba(0,0,0,0.08)]">
              <img
                src="https://images.unsplash.com/photo-1560493676-04071c5f467b?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8YWdyaWN1bHR1cmV8ZW58MHx8MHx8fDA%3D"
                alt="Rows of green crops at sunset"
                className="h-56 w-full object-cover md:h-64"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </div>

            <div className="relative mt-4 flex items-center justify-between rounded-2xl border border-white/80 bg-white/70 p-5 backdrop-blur-md">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">AgroVani</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Live field insights</h2>
              </div>
              <span className="badge-green">50K+ farms</span>
            </div>

            <div className="relative mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_6px_20px_rgba(0,0,0,0.04)] backdrop-blur-md">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Residue Forecast</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">3.4 <span className="text-lg text-slate-500">t/acre</span></p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_6px_20px_rgba(0,0,0,0.04)] backdrop-blur-md">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">Night Heat Stress</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-emerald-600">7.1 <span className="text-lg text-slate-500">/ 9</span></p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
