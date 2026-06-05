import { APIException, fetchWithTimeout } from './http'

import type { UniRefIdentity, UniRefMember } from '#/types/uniref'

const UNIPROT_BASE = 'https://rest.uniprot.org'

interface RawMember {
  memberId: string
  memberIdType: string
  proteinName: string
  organism: { scientificName: string; commonName?: string }
  accessions?: string[]
}

interface UniRefMembersResponse {
  members: RawMember[]
  memberCount: number
}

function toUniRefMember(raw: RawMember, clusterName: string): UniRefMember {
  return {
    accession: raw.accessions?.[0] ?? raw.memberId,
    proteinName: raw.proteinName,
    organism: {
      scientificName: raw.organism.scientificName,
      commonName: raw.organism.commonName,
    },
    unirefCluster: clusterName,
  }
}

export async function fetchUniRefMembers(
  accession: string,
  identity: UniRefIdentity,
  size = 10,
): Promise<UniRefMember[]> {
  const clusterName = `UniRef${identity}_${accession}`
  const url = `${UNIPROT_BASE}/uniref/${clusterName}/members?format=json&size=${size}`

  const response = await fetchWithTimeout(url, { timeout: 10000 }).catch(() => {
    throw new APIException(`UniRef unreachable for ${clusterName}`, 0)
  })

  // 404 means the protein has no cluster at this identity level — not an error
  if (response.status === 404) return []

  if (!response.ok) {
    throw new APIException(
      `UniRef error: ${response.statusText}`,
      response.status,
    )
  }

  const body = (await response.json()) as UniRefMembersResponse
  return body.members.map((m) => toUniRefMember(m, clusterName))
}
