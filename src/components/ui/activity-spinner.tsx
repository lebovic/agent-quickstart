// Activity spinner that cycles through star characters
const SPINNER_CHARS = ["·", "✦", "✶", "❋", "✹"]

export function ActivitySpinner({ className = "text-accent-main-100" }: { className?: string }) {
  return (
    <span className={`font-mono inline-block overflow-hidden text-center align-middle relative ${className}`}>
      <span className="invisible">❋</span>
      <style>{`
        @keyframes codeSpinnerSpin {
          0%, 90%, 100% { transform: translateY(0em); }
          10% { transform: translateY(-2em); }
          20% { transform: translateY(-4em); }
          30% { transform: translateY(-6em); }
          40%, 50% { transform: translateY(-8em); }
          60% { transform: translateY(-6em); }
          70% { transform: translateY(-4em); }
          80% { transform: translateY(-2em); }
        }
        .code-spinner-animate {
          animation: codeSpinnerSpin 1200ms step-start infinite;
        }
      `}</style>
      <span className="code-spinner-animate absolute inset-0 flex flex-col items-center">
        {SPINNER_CHARS.map((char, i) => (
          <span key={i} style={{ lineHeight: "2em" }}>
            {char}
          </span>
        ))}
      </span>
    </span>
  )
}
