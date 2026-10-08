export const MIN_CENTS = 100;        // 1 €
export const MAX_CENTS = 1_000_000;  // 10.000 €

/** 50% a la ONG (hacia abajo), el resto para el creador. Siempre suman el total. */
export function splitAmount(cents) {
  const charity = Math.floor(cents / 2);
  return { charity, creator: cents - charity };
}

export function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}
