import { coachBlocks } from "@/lib/coach-markdown";

export function CoachMarkdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = coachBlocks(text);
  return (
    <div className={className}>
      {blocks.map((line, index) =>
        line.length === 0 ? (
          <span key={index} className="block h-2" />
        ) : (
          <p key={index} className={index > 0 ? "mt-2" : undefined}>
            {line.map((span, spanIndex) =>
              span.bold ? <strong key={spanIndex}>{span.text}</strong> : <span key={spanIndex}>{span.text}</span>,
            )}
          </p>
        ),
      )}
    </div>
  );
}
