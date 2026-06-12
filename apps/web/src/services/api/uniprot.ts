import { SequenceException, fetchWithTimeout } from './http'

import type { SequenceResult } from '#/types/sequence'

const UNIPROT_BASE = 'https://rest.uniprot.org'

interface UniprotEntry {
  primaryAccession: string
  // Absent for obsolete/deleted/demerged entries, which UniProt still returns
  // with HTTP 200 and `entryType: "Inactive"` — guarded in toSequenceResult.
  sequence?: { value: string }
}

async function queryUniprot(url: string): Promise<UniprotEntry> {
  const response = await fetchWithTimeout(url, { timeout: 10000 }).catch(
    (e) => {
      throw new SequenceException(
        'Oops... something went wrong contacting Uniprot; Please try again later',
        e,
      )
    },
  )

  if (response.status === 404) {
    throw new SequenceException(
      'Could not find a sequence with this identifier.',
    )
  }

  if (!response.ok) {
    throw new SequenceException(
      'Oops... something went wrong at Uniprot; Please try again later',
    )
  }

  const body = (await response.json()) as
    | UniprotEntry
    | { results: UniprotEntry[] }

  if ('results' in body) {
    if (body.results.length === 0) {
      throw new SequenceException(
        'Could not find a protein matching the criteria',
      )
    }
    return body.results[0]!
  }

  return body
}

function toSequenceResult(entry: UniprotEntry): SequenceResult {
  if (!entry.sequence?.value) {
    throw new SequenceException(
      'This UniProt entry has no sequence — it may be obsolete or deleted. Please try a different identifier.',
    )
  }
  return {
    accession: entry.primaryAccession,
    sequence: entry.sequence.value,
  }
}

export async function fetchSequenceById(
  accession: string,
): Promise<SequenceResult> {
  const url = `${UNIPROT_BASE}/uniprotkb/${accession.trim()}?fields=accession,sequence&format=json`
  const entry = await queryUniprot(url)
  return toSequenceResult(entry)
}

export async function fetchSequenceByName(
  name: string,
): Promise<SequenceResult> {
  const q = name.trim()
  const url = `${UNIPROT_BASE}/uniprotkb/search?query=id:${q}+OR+protein_name:${q}&fields=accession,sequence&format=json&size=1`
  const entry = await queryUniprot(url)
  return toSequenceResult(entry)
}

export async function getUniprotStatus(): Promise<string> {
  const testAccession = 'P04637'
  const url = `${UNIPROT_BASE}/uniprotkb/${testAccession}?fields=accession&format=json`
  const entry = await queryUniprot(url)
  if (entry.primaryAccession !== testAccession) {
    throw new SequenceException(
      'Oops... something went wrong contacting Uniprot; Please try again later',
    )
  }
  return entry.primaryAccession
}
