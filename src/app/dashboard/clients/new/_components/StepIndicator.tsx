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
                    ? 'bg-emerald-500 text-white'
                    : isActive
                      ? 'bg-blue-500 text-white ring-4 ring-blue-100'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {isComplete ? '✓' : stepNum}
              </div>
              <span
                className={`mt-2 text-xs font-medium whitespace-nowrap ${
                  isActive ? 'text-blue-700' : isComplete ? 'text-emerald-700' : 'text-slate-400'
                }`}
              >
                {labels[index]}
              </span>
            </div>

            {stepNum < totalSteps && (
              <div
                className={`flex-1 h-0.5 mx-2 mb-6 transition-all ${
                  isComplete ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
