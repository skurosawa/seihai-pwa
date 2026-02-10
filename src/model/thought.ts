export function splitThoughts(rawText: string): string[] {
  const seen = new Set<string>();
  const lines = rawText
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const out: string[] = [];
  for (const line of lines) {
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

export function generateAction(thoughts: string[]): string {
  const todo = thoughts.find(t => /TODO|やる|する/.test(t));
  if (todo) return todo;

  const q = thoughts.find(t => /[?？]/.test(t));
  if (q) return q;

  return thoughts[0] ?? "";
}