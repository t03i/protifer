export interface UniRefMember {
  accession: string
  proteinName: string
  organism: {
    scientificName: string
    commonName?: string
  }
  unirefCluster: string
}

export type UniRefIdentity = 100 | 90 | 50
