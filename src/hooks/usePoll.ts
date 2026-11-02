import { useCallback, useEffect, useRef, useState } from "react";

/** Poll a fetcher on an interval, skipping ticks mid-fetch; 0 stops, a new fetcher clears data. */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
): { data: T | null; error: string | null; refresh: () => void; reset: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const inFlight = useRef(false);
  const generation = useRef(0);

  const doFetch = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const gen = generation.current;
    try {
      const result = await fetcherRef.current();
      if (gen !== generation.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (gen !== generation.current) return;
      setError(String(e));
    } finally {
      // only the current generation owns the gate
      if (gen === generation.current) inFlight.current = false;
    }
  }, []);

  /** Reset the data and error, discarding any reply still in flight. */
  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setData(null);
    setError(null);
  }, []);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setData(null);
  }, [fetcher]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    doFetch();
    const id = setInterval(doFetch, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, doFetch, fetcher]);

  return { data, error, refresh: doFetch, reset };
}
