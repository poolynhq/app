import { useEffect, useState } from "react";

/** Live M:SS until `iso` (UTC); null when no deadline. */
export function useExpiryCountdown(iso: string | null | undefined): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) {
      setLabel(null);
      return;
    }
    const end = new Date(iso).getTime();
    const tick = () => {
      const ms = end - Date.now();
      if (ms <= 0) {
        setLabel("0:00");
        return;
      }
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      setLabel(`${m}:${sec.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);

  return label;
}
