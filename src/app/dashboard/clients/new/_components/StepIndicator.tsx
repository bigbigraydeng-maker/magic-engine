'use client'

interface Props {
  currentStep: number
  totalSteps: number
  labels: string[]
}

export default function StepIndicator({ currentStep, totalSteps, labels }: Props) {
  return (
    <div className="flex items-center justify-between">
      {Array.from({ length: totalSteps }).map((_, index) => {
        const stepNum = index + 1
        const isActive = stepNum === currentStep
        const isComplete = stepNum < currentStep

        return (
          <div key={stepNum} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold text-sm transition-all ${
                  isComplete
                    ? 'bg-[#5C8A4A] text-white'
                    : isActive
                      ? 'bg-me-ochre text-white ring-4 ring-me-ochre/20'
                      : 'bg-me-stone text-me-charcoal/55'
                }`}
              >
                {isComplete ? '✓' : stepNum}
              </div>
              <span
                className={`mt-2 text-xs font-medium whitespace-nowrap ${
                  isActive ? 'text-me-ochre' : isComplete ? 'text-[#5C8A4A]' : 'text-me-charcoal/45'
                }`}
              >
                {labels[index]}
              </span>
            </div>

            {stepNum < totalSteps && (
              <div
                className={`flex-1 h-0.5 mx-2 mb-6 transition-all ${
                  isComplete ? 'bg-[#5C8A4A]' : 'bg-me-stone'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
