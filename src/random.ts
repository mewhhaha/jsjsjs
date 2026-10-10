/** Deterministic hashing and random numbers shared by js3 modules; the prelude does not re-export them. */

/** 32-bit FNV-1a over UTF-16 code units, as an unsigned integer. */
export function fnv1a(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a repeatable generator of [0, 1), independent of Math.random. */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
