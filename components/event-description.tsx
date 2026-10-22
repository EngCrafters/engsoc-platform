import { descriptionTokens } from "@/lib/events/description";

/** A description with its safe links; React renders everything else as text. */
export function EventDescription({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]" dir="auto">
      {descriptionTokens(text).map((token, index) =>
        token.href ? (
          <a
            key={index}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2"
          >
            {token.text}
          </a>
        ) : (
          <span key={index}>{token.text}</span>
        )
      )}
    </p>
  );
}
