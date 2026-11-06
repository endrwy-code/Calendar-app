import { ChevronDown, MoreHorizontal, X } from 'lucide-react';

/** Visual stand-in for Telegram's fullscreen chrome when previewing with ?tgsim. */
export function TgSim() {
  return (
    <div className="tg-sim" aria-hidden>
      <div className="tg-sim-status">
        <span>9:41</span>
        <span>●●● ▮</span>
      </div>
      <div className="tg-sim-controls">
        <span className="tg-sim-pill">
          <X size={16} /> Close
        </span>
        <span className="tg-sim-pill">
          <ChevronDown size={16} />
          <MoreHorizontal size={16} />
        </span>
      </div>
    </div>
  );
}
