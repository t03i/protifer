import { describe, expect, it, vi } from 'vitest'

import {
  MODEL_INVENTORY_MEDIA_TYPE,
  ModelInventoryError,
  fetchModelInventoryFromOci,
  parseModelInventory,
  parseOciRef,
} from './inventory.ts'

const VALID = {
  models: [
    {
      triton: 'prot_t5_pipeline',
      id: 'prott5_xl_u50',
      role: 'embedding',
      version: 'abc',
    },
    { triton: '_tmbed_viterbi', role: 'internal', version: 'def' },
  ],
}

describe('parseModelInventory', () => {
  it('accepts a valid inventory', () => {
    expect(parseModelInventory(VALID).models.length).toBe(2)
  })

  it('rejects an unknown role', () => {
    expect(() =>
      parseModelInventory({
        models: [{ triton: 'x', role: 'bogus', version: 'v' }],
      }),
    ).toThrow(ModelInventoryError)
  })

  it('requires id on embedding/prediction entries', () => {
    expect(() =>
      parseModelInventory({
        models: [{ triton: 'x', role: 'prediction', version: 'v' }],
      }),
    ).toThrow(/require an `id`/)
  })

  it('allows internal entries without id', () => {
    const inv = parseModelInventory({
      models: [{ triton: '_x', role: 'internal', version: 'v' }],
    })
    expect(inv.models[0]?.id).toBeUndefined()
  })

  it('rejects an empty model list', () => {
    expect(() => parseModelInventory({ models: [] })).toThrow(
      ModelInventoryError,
    )
  })
})

describe('parseOciRef', () => {
  it('parses a digest ref', () => {
    expect(parseOciRef('ghcr.io/org/model-repo@sha256:deadbeef')).toEqual({
      host: 'ghcr.io',
      repo: 'org/model-repo',
      reference: 'sha256:deadbeef',
    })
  })

  it('parses a tag ref', () => {
    expect(parseOciRef('registry:5000/org/model-repo:dev')).toEqual({
      host: 'registry:5000',
      repo: 'org/model-repo',
      reference: 'dev',
    })
  })

  it('defaults to latest when no tag/digest', () => {
    expect(parseOciRef('ghcr.io/org/model-repo').reference).toBe('latest')
  })

  it('rejects a ref with no repo path', () => {
    expect(() => parseOciRef('ghcr.io')).toThrow(ModelInventoryError)
  })
})

describe('fetchModelInventoryFromOci', () => {
  it('fetches the config descriptor then the blob', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ config: { digest: 'sha256:cfg' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(VALID), { status: 200 }),
      ) as unknown as typeof fetch

    const inv = await fetchModelInventoryFromOci({
      ref: 'ghcr.io/org/model-repo@sha256:x',
      fetchImpl,
    })
    expect(inv.models.length).toBe(2)
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0]?.[0]).toContain('/manifests/sha256:x')
    expect(calls[1]?.[0]).toContain('/blobs/sha256:cfg')
  })

  it('resolves a bearer challenge and retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:org/model-repo:pull"',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'minted' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ config: { digest: 'sha256:cfg' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(VALID), { status: 200 }),
      ) as unknown as typeof fetch

    const inv = await fetchModelInventoryFromOci({
      ref: 'ghcr.io/org/model-repo:dev',
      fetchImpl,
    })
    expect(inv.models.length).toBe(2)
  })

  it('fails loud on a non-200 manifest', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('', { status: 404 }),
      ) as unknown as typeof fetch
    await expect(
      fetchModelInventoryFromOci({ ref: 'ghcr.io/org/repo:dev', fetchImpl }),
    ).rejects.toThrow(ModelInventoryError)
  })
})

describe('MODEL_INVENTORY_MEDIA_TYPE', () => {
  it('is the protifer custom mediaType', () => {
    expect(MODEL_INVENTORY_MEDIA_TYPE).toBe(
      'application/vnd.protifer.model-inventory.v1+json',
    )
  })
})
