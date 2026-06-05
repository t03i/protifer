export interface FooterLink {
  label: string
  to?: string
  href?: string
}

export interface FooterSection {
  heading: string
  links: readonly FooterLink[]
}

export const footerSections: readonly FooterSection[] = [
  {
    heading: 'Resources',
    links: [
      { label: 'Methods', to: '/methods' },
      { label: 'Glossary', to: '/glossary' },
      { label: 'Cite', to: '/cite' },
      { label: 'FAQ', to: '/faq' },
    ],
  },
  {
    heading: 'External services',
    links: [
      { label: 'UniProt', href: 'https://www.uniprot.org/' },
      { label: 'AlphaFold DB', href: 'https://alphafold.ebi.ac.uk/' },
      { label: 'ColabFold', href: 'https://colabfold.mmseqs.com/' },
    ],
  },
  {
    heading: 'Institutional',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Rostlab', href: 'https://rostlab.org/' },
      { label: 'GitHub', href: 'https://github.com/t03i/protifer' },
      { label: 'Imprint', to: '/imprint' },
      { label: 'Privacy', to: '/legal' },
      { label: 'Terms of Use', to: '/terms' },
    ],
  },
] as const
