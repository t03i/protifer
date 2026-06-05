import type { UseQueryResult } from '@tanstack/react-query'

import { Skeleton } from '#/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { useUniRefClusters } from '#/features/uniref/hooks/use-uniref-clusters'
import type { UniRefMember } from '#/types/uniref'

interface Props {
  accession: string
}

function MemberTable({ members }: { members: UniRefMember[] }) {
  if (members.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        No members found at this identity level.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Accession</TableHead>
          <TableHead>Protein Name</TableHead>
          <TableHead>Organism</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.accession}>
            <TableCell>
              <a
                href={`https://www.uniprot.org/uniprotkb/${m.accession}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm underline decoration-dotted hover:decoration-solid"
              >
                {m.accession}
              </a>
            </TableCell>
            <TableCell className="max-w-xs truncate text-sm">
              {m.proteinName}
            </TableCell>
            <TableCell className="text-sm italic">
              {m.organism.scientificName}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ClusterTabContent({
  query,
  clusterName,
}: {
  query: UseQueryResult<UniRefMember[]>
  clusterName: string
}) {
  if (query.isLoading) {
    return (
      <div className="space-y-2 py-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  const members = query.data ?? []

  return (
    <div className="space-y-2">
      <MemberTable members={members} />
      {members.length > 0 && (
        <a
          href={`https://www.uniprot.org/uniref/${clusterName}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground underline decoration-dotted hover:decoration-solid"
        >
          View all entries in UniProtKB for {clusterName}
        </a>
      )}
    </div>
  )
}

export function UniRefClusters({ accession }: Props) {
  const { q100, q90, q50 } = useUniRefClusters(accession)

  return (
    <Tabs defaultValue="100">
      <TabsList>
        <TabsTrigger value="100">100% identity</TabsTrigger>
        <TabsTrigger value="90">90% identity</TabsTrigger>
        <TabsTrigger value="50">50% identity</TabsTrigger>
      </TabsList>
      <TabsContent value="100">
        <ClusterTabContent
          query={q100}
          clusterName={`UniRef100_${accession}`}
        />
      </TabsContent>
      <TabsContent value="90">
        <ClusterTabContent query={q90} clusterName={`UniRef90_${accession}`} />
      </TabsContent>
      <TabsContent value="50">
        <ClusterTabContent query={q50} clusterName={`UniRef50_${accession}`} />
      </TabsContent>
    </Tabs>
  )
}
