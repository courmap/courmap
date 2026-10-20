/** Where the weekly digest goes. Both are optional secrets; with neither set the digest is only printed. */
export interface NotifyTargets {
  /** An ntfy topic URL, e.g. https://ntfy.sh/<topic>. */
  ntfyUrl?: string;
  /** A Discord webhook URL. */
  discordWebhook?: string;
}

export async function sendDigest(title: string, body: string, targets: NotifyTargets, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<string[]> {
  const sent: string[] = [];
  if (targets.ntfyUrl) {
    const res = await fetchFn(targets.ntfyUrl, { method: 'POST', headers: { Title: title, Tags: 'clipboard' }, body });
    if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
    sent.push('ntfy');
  }
  if (targets.discordWebhook) {
    // Discord caps a message at 2,000 characters, so a long digest goes out as several messages, split
    // between lines. Flag 4 (SUPPRESS_EMBEDS) keeps the links clickable without a preview card for each.
    for (const content of discordChunks(`**${title}**\n${body}`)) {
      const res = await fetchFn(targets.discordWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, flags: 4, allowed_mentions: { parse: [] } }) });
      if (!res.ok) throw new Error(`Discord: HTTP ${res.status}`);
    }
    sent.push('discord');
  }
  return sent;
}

/** Splits text into pieces of at most `limit` characters, at line breaks where it can (a longer line is cut). */
export function discordChunks(text: string, limit = 2000): string[] {
  const out: string[] = [];
  let cur = '';
  for (let line of text.split('\n')) {
    while (line.length > limit) {
      if (cur) (out.push(cur), (cur = ''));
      out.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    if (cur.length + line.length + 1 > limit) (out.push(cur), (cur = line));
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}
