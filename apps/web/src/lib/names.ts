/** File names read from a .zip without its UTF-8 flag come out as Latin-1 ("PadraÌo"); read them again as UTF-8. */
export function fixName(s: string) {
  if (!/[\u0080-\u00ff]/.test(s) || [...s].some((c) => c.charCodeAt(0) > 0xff)) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))
      .normalize('NFC');
  } catch {
    return s;
  }
}
