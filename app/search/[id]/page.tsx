import { Suspense } from 'react'
import SearchView from '@/components/SearchView'

export default function Page({ params }: PageProps<'/search/[id]'>) {
  return (
    <Suspense fallback={<p className="py-20 text-center text-muted">Loading the switchboard…</p>}>
      <Search params={params} />
    </Suspense>
  )
}

async function Search({ params }: { params: PageProps<'/search/[id]'>['params'] }) {
  const { id } = await params
  return <SearchView id={id} />
}
