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
    // Discord caps a message at 2,000 characters.
    const content = `**${title}**\n${body}`.slice(0, 2000);
    const res = await fetchFn(targets.discordWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
    if (!res.ok) throw new Error(`Discord: HTTP ${res.status}`);
    sent.push('discord');
  }
  return sent;
}
