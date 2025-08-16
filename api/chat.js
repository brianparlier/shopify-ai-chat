// --- Helpers ---
const STOPWORDS = new Set(['i','need','an','a','the','for','of','to','please','show','me','do','you','have']);

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function scoreMatches(prompt, items, fields = ['title','body','tags']) {
  const terms = Array.from(new Set(tokenize(prompt)));
  if (!terms.length) return [];
  return items
    .map((it) => {
      const hay = fields.map(f => (it[f] || '')).join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score++;
      return { item: it, score };
    })
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.item);
}
