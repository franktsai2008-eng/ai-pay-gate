import { useState } from "react";

const CARDS = [
  { tone: "", title: "What a seal actually proves", time: "2 min", body: "A seal means a real person or business verified who they are, once, with an ID or a passkey. Helpers get their seal from the person who owns them. When you see the little S beside a name, Sigil knows who is on the other side. Without it, you're sending to a string of letters and numbers." },
  { tone: "sage", title: "Give your helper an allowance that fits", time: "3 min", body: "Start with what you'd hand a trusted friend for a week of errands. Set 'pays alone up to' to the price of a normal purchase, and the weekly allowance to the most it should ever need. Anything bigger comes to your phone first. You can loosen both later from its page." },
  { tone: "clay", title: "Why helpers stop and ask", time: "1 min", body: "Four things make a helper pause: more than it may spend alone, a place it has never paid, a wallet that isn't sealed, or an odd hour. It tells you which, and why it wanted to pay. Nothing moves until you swipe." },
  { tone: "paper", title: "Pausing is instant, and safe", time: "1 min", body: "Flip the switch on any helper and its key stops working that second. Money already in its wallet stays put. Resume whenever you like; nothing is lost." },
];

/** Robinhood's "Discover" rail, but for the three or four ideas a first-timer needs. */
export function LearnRail() {
  const [open, setOpen] = useState<number | null>(null);
  if (open !== null) {
    const c = CARDS[open];
    return (
      <button className={`learn open ${c.tone}`} onClick={() => setOpen(null)}>
        <b>{c.title}</b>
        <div className="body">{c.body}</div>
        <span>Tap to close</span>
      </button>
    );
  }
  return (
    <div className="rail">
      {CARDS.map((c, i) => <button key={i} className={`learn ${c.tone}`} onClick={() => setOpen(i)}><b>{c.title}</b><span>{c.time} read</span></button>)}
    </div>
  );
}
