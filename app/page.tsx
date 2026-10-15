import SearchForm from '@/components/SearchForm'

const STEPS = [
  ['१', 'Tell us what you need', 'Type it or say it. You review every field before anything happens.'],
  ['२', 'We call the shops at once', 'Our voice agent rings up to 5 nearby shops in parallel, in Hindi or English, about 45 seconds each.'],
  ['३', 'Compare, then hold it', 'Verified stock, price and readiness, side by side. One tap asks the best shop to keep it for you.'],
]

export default function Home() {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-12">
      <section className="lg:col-span-6 lg:pt-6" aria-labelledby="pitch">
        <p className="rise text-sm font-semibold uppercase tracking-[0.2em] text-marigold-deep">Voice AI for the neighbourhood bazaar</p>
        <h1 id="pitch" className="rise mt-4 font-display text-5xl leading-[1.02] tracking-tight [animation-delay:80ms] sm:text-6xl xl:text-7xl">
          India&apos;s shops have no inventory API.{' '}
          <span className="block">
            The <span className="bg-[linear-gradient(transparent_58%,rgb(240_162_2/0.5)_58%)] box-decoration-clone px-1">phone</span> is the API.
          </span>
        </h1>
        <p className="rise mt-6 max-w-xl text-xl leading-relaxed text-muted [animation-delay:160ms]">
          Tell Poochho what you need. It calls the shops near you at the same time, then shows who has it, for how much, and how soon.{' '}
          <span lang="hi" className="text-ink">
            आप बताइए, हम पूछ लेंगे।
          </span>
        </p>
        <ol className="mt-10 space-y-6">
          {STEPS.map(([n, title, body], i) => (
            <li key={n} className="rise flex gap-5" style={{ animationDelay: `${260 + i * 90}ms` }}>
              <span className="font-display text-5xl leading-none text-marigold" aria-hidden>
                {n}
              </span>
              <div>
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="mt-1 text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <ul className="rise mt-10 flex flex-wrap gap-2 text-sm [animation-delay:560ms]" aria-label="Safeguards">
          {['Says it is an AI, first sentence', 'Only consenting test shops', 'Never invents a price', 'Opt-outs are permanent'].map((t) => (
            <li key={t} className="rounded-full border border-line bg-card px-3 py-1.5 text-muted">
              {t}
            </li>
          ))}
        </ul>
      </section>
      <section className="lg:col-span-6" aria-label="Start a search">
        <SearchForm />
      </section>
    </div>
  )
}
