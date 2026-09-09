import './globals.css'
import { Inter } from 'next/font/google'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata = {
  title: 'AgroVani — Annam.ai',
  description: 'Clean residue, smarter fields, stronger incomes. Precision residue insights and biostimulant crop-health decisions for Indian farmers.',
  applicationName: 'AgroVani',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'AgroVani' },
}

export const viewport = {
  themeColor: '#006a42',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.className}>
      <head>
        <script dangerouslySetInnerHTML={{__html:'window.addEventListener("error",function(e){if(e.error instanceof DOMException&&e.error.name==="DataCloneError"&&e.message&&e.message.includes("PerformanceServerTiming")){e.stopImmediatePropagation();e.preventDefault()}},true);'}} />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
