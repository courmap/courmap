import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { LABELS } from './report.js';

const run = promisify(execFile);

/**
 * Opens and updates the bots' PRs and issues through the gh and git CLIs. It never merges and
 * never approves: step 9 runs in dry-run mode, so even tier A PRs wait for a person. With
 * `apply: false` every action is only logged.
 */
export class GitHubWriter {
  readonly actions: string[] = [];

  constructor(
    private readonly opts: { apply: boolean; repoDir: string; log?: (line: string) => void },
  ) {}

  private log(line: string): void {
    this.actions.push(line);
    (this.opts.log ?? console.log)(`${this.opts.apply ? '' : '[dry run] '}${line}`);
  }

  private async gh(args: string[]): Promise<string> {
    const { stdout } = await run('gh', args, { cwd: this.opts.repoDir, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  }

  private async git(args: string[], cwd = this.opts.repoDir): Promise<string> {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  }

  async ensureLabels(): Promise<void> {
    if (!this.opts.apply) return;
    const colors: Record<string, string> = { [LABELS.bot]: 'ededed', [LABELS.A]: '0e8a16', [LABELS.B]: 'fbca04', [LABELS.conflict]: 'd93f0b', [LABELS.firstMapping]: '7057ff', [LABELS.tracker]: '1d76db', [LABELS.botFailure]: 'b60205', seed: 'c5def5' };
    for (const [name, color] of Object.entries(colors)) await this.gh(['label', 'create', name, '--color', color, '--force']);
  }

  private async findIssue(title: string, label: string): Promise<number | null> {
    const list = JSON.parse(await this.gh(['issue', 'list', '--state', 'open', '--label', label, '--limit', '200', '--json', 'number,title'])) as { number: number; title: string }[];
    return list.find((i) => i.title === title)?.number ?? null;
  }

  /** Creates the issue, or rewrites the body of the open one with the same title. Returns its URL (or a placeholder in dry run). */
  async upsertIssue(title: string, body: string, labels: string[], opts: { pin?: boolean } = {}): Promise<string> {
    if (!this.opts.apply) {
      this.log(`issue "${title}" [${labels.join(', ')}]`);
      return `(dry run) ${title}`;
    }
    const existing = await this.findIssue(title, labels[labels.length - 1]!);
    const file = await tempFile(body);
    try {
      if (existing !== null) {
        await this.gh(['issue', 'edit', String(existing), '--body-file', file]);
        this.log(`updated issue #${existing} "${title}"`);
        return (await this.gh(['issue', 'view', String(existing), '--json', 'url', '--jq', '.url']));
      }
      const url = await this.gh(['issue', 'create', '--title', title, '--body-file', file, ...labels.flatMap((l) => ['--label', l])]);
      this.log(`opened issue ${url} "${title}"`);
      if (opts.pin) await this.gh(['issue', 'pin', url]).catch(() => this.log(`could not pin ${url}`));
      return url;
    } finally {
      await rm(path.dirname(file), { recursive: true, force: true });
    }
  }

  /**
   * Puts `files` on `branch` as one commit on top of origin/main and opens or updates its PR.
   * Works in a temporary worktree, so the checkout the bots run in is never touched. Nothing is
   * pushed when the branch already has exactly this content.
   */
  async upsertPullRequest(branch: string, title: string, body: string, labels: string[], files: Map<string, string>): Promise<string | null> {
    if (!this.opts.apply) {
      this.log(`PR ${branch} "${title}" [${labels.join(', ')}]: ${[...files.keys()].join(', ')}`);
      return null;
    }
    await this.git(['fetch', '--quiet', 'origin', 'main']);
    const dir = await mkdtemp(path.join(tmpdir(), 'courmap-bots-'));
    try {
      await this.git(['worktree', 'add', '--quiet', '-B', branch, dir, 'origin/main']);
      for (const [rel, text] of files) {
        await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await writeFile(path.join(dir, rel), text);
      }
      await this.git(['add', '--', ...files.keys()], dir);
      if ((await this.git(['diff', '--cached', '--name-only'], dir)) === '') {
        this.log(`PR ${branch}: main already has this content; skipped`);
        return null;
      }
      await this.git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '--quiet', '-m', title], dir);
      const remote = await this.git(['ls-remote', 'origin', `refs/heads/${branch}`]);
      const unchanged = remote !== '' && (await this.git(['fetch', '--quiet', 'origin', branch], dir).then(() => this.git(['diff', '--name-only', 'FETCH_HEAD', 'HEAD'], dir))) === '';
      if (!unchanged) await this.git(['push', '--quiet', '--force', 'origin', `HEAD:refs/heads/${branch}`], dir);
      const file = await tempFile(body);
      try {
        const existing = await this.gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url']);
        if (existing) {
          await this.gh(['pr', 'edit', existing, '--title', title, '--body-file', file]);
          this.log(`updated PR ${existing}${unchanged ? ' (branch unchanged)' : ''}`);
          return existing;
        }
        const url = await this.gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body-file', file, ...labels.flatMap((l) => ['--label', l])]);
        this.log(`opened PR ${url}`);
        return url;
      } finally {
        await rm(path.dirname(file), { recursive: true, force: true });
      }
    } finally {
      await this.git(['worktree', 'remove', '--force', dir]).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Open and recently merged bot PRs and open issues, for the digest. */
  async list(kind: 'pr' | 'issue', label: string, state: 'open' | 'merged' | 'all'): Promise<{ title: string; url: string; createdAt: string; mergedAt?: string | null }[]> {
    const fields = kind === 'pr' ? 'title,url,createdAt,mergedAt' : 'title,url,createdAt';
    return JSON.parse(await this.gh([kind, 'list', '--label', label, '--state', state, '--limit', '200', '--json', fields])) as never;
  }
}

async function tempFile(text: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'courmap-body-'));
  const file = path.join(dir, 'body.md');
  await writeFile(file, text);
  return file;
}
