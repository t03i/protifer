import { Link, createFileRoute } from '@tanstack/react-router'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '#/components/ui/accordion'
import type { FaqLink } from '#/content/faq'
import { faqItems } from '#/content/faq'

export const Route = createFileRoute('/faq')({
  component: FaqPage,
})

function SeeAlsoLink({ link }: { link: FaqLink }) {
  if (link.to) {
    return (
      <Link to={link.to} className="text-primary hover:underline">
        {link.label}
      </Link>
    )
  }
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {link.label}
    </a>
  )
}

function FaqPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">FAQ</h1>
        <p className="text-muted-foreground">
          Short answers to the questions we get most often. Links take you to
          the authoritative page when there is more to say.
        </p>
      </header>

      <Accordion type="multiple" className="w-full">
        {faqItems.map((item) => (
          <AccordionItem key={item.id} value={item.id} id={item.id}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent className="space-y-3 text-muted-foreground">
              <p>{item.answer}</p>
              {item.seeAlso && item.seeAlso.length > 0 && (
                <p className="text-xs">
                  See also:{' '}
                  {item.seeAlso.map((link, idx) => (
                    <span key={link.label}>
                      <SeeAlsoLink link={link} />
                      {idx < item.seeAlso!.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </article>
  )
}
