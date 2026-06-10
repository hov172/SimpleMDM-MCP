import { compareVersions } from "./evaluate.mjs";

export class QueryError extends Error {}

// Whitespace-split tokenizer; double quotes glue spaces into one token and are
// kept in the token (stripped later by the term parser).
export function tokenize(q) {
  const out = [];
  const s = String(q ?? "");
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let buf = "";
    let quoted = false;
    while (i < s.length && (quoted || !/\s/.test(s[i]))) {
      if (s[i] === '"') quoted = !quoted;
      buf += s[i];
      i++;
    }
    if (quoted) throw new QueryError(`Unbalanced quote in: ${buf}`);
    out.push(buf);
  }
  return out;
}
