import type { Metadata } from 'next'
import { Anek_Devanagari, Geist_Mono, Rozha_One } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const rozha = Rozha_One({ weight: '400', subsets: ['latin', 'devanagari'], variable: '--font-rozha' })
const anek = Anek_Devanagari({ subsets: ['latin', 'devanagari'], variable: '--font-anek' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'Poochho · We call the shops for you',
  description: "India's shops have no inventory API. The phone is the API. Poochho calls local shops in parallel and compares their answers.",
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${rozha.variable} ${anek.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col text-[17px]">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="border-b border-line/80">
          <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8" aria-label="Main">
            <Link href="/" className="group flex items-baseline gap-3">
              <span className="font-display text-3xl leading-none tracking-tight">Poochho</span>
              <span className="font-display text-xl leading-none text-marigold-deep" lang="hi">
                पूछो
              </span>
            </Link>
            <div className="flex items-center gap-1 text-[15px] font-medium">
              <Link href="/" className="rounded-full px-4 py-2 hover:bg-ink/5">
                New search
              </Link>
              <Link href="/metrics" className="rounded-full px-4 py-2 hover:bg-ink/5">
                Metrics
              </Link>
            </div>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
          {children}
        </main>
        <footer className="border-t border-line/80 px-5 py-6 text-center text-sm text-muted sm:px-8">
          Poochho only calls consenting test shops, between 9 am and 8 pm IST, and its voice agent says it is an AI in the first sentence. Calls run on Bolna; Poochho&apos;s own ranking and
          summaries are deterministic code, not an LLM.
        </footer>
      </body>
    </html>
  )
}
