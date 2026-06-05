import { PredictionCard } from '#/components/marketing/PredictionCard'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '#/components/ui/carousel'
import { predictions } from '#/content/predictions'

export function PredictionCarousel() {
  return (
    <section aria-labelledby="predictions-heading" className="py-16">
      <h2
        id="predictions-heading"
        className="mb-10 text-center text-2xl font-semibold"
      >
        What we predict
      </h2>

      <Carousel
        opts={{ align: 'start', loop: false }}
        className="w-full"
        aria-label="Prediction types"
      >
        <CarouselContent className="-ml-4">
          {predictions.map((prediction) => (
            <CarouselItem
              key={prediction.id}
              className="pl-4 md:basis-1/2 lg:basis-1/3"
            >
              <PredictionCard prediction={prediction} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious aria-label="Previous prediction" />
        <CarouselNext aria-label="Next prediction" />
      </Carousel>
    </section>
  )
}
