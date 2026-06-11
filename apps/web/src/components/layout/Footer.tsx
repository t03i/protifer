import { Link } from '@tanstack/react-router'

import type { FooterLink } from '#/content/footer-links'
import { footerSections } from '#/content/footer-links'
import { VersionInfo } from '#/features/status/VersionInfo'

function renderLink(link: FooterLink) {
  if (link.to) {
    return (
      <Link
        to={link.to}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {link.label}
      </Link>
    )
  }
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      {link.label}
    </a>
  )
}

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-12 border-t bg-background">
      <div className="container mx-auto grid grid-cols-1 gap-8 px-4 py-10 sm:grid-cols-2 md:grid-cols-3">
        {footerSections.map((section) => (
          <section
            key={section.heading}
            aria-labelledby={`footer-${section.heading}`}
          >
            <h2
              id={`footer-${section.heading}`}
              className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground"
            >
              {section.heading}
            </h2>
            <ul className="space-y-2">
              {section.links.map((link) => (
                <li key={link.label}>{renderLink(link)}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="border-t">
        <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {year} Rostlab · Department of Bioinformatics, Technical
            University of Munich.
          </p>
          <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-4">
            <p>Research tool — not for diagnostic use.</p>
            <VersionInfo />
          </div>
        </div>
      </div>
    </footer>
  )
}
