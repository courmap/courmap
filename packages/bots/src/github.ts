import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { LABELS } from './report.js';

const execFileAsync = promisify(execFile);

/** Runs a command and returns its trimmed stdout; `env` is added to the process environment. Injected in tests. */
export type Runner = (cmd: 'gh' | 'git', args: string[], cwd: string, env?: Record<string, string>) => Promise<string>;

const defaultRunner: Runner = async (cmd, args, cwd, env) =>
  (await execFileAsync(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env })).stdout.trim();

/**
 * Opens and updates the bots' PRs and issues through the gh and git CLIs. It never merges and
 * never approves: step 9 runs in dry-run mode, so even tier A PRs wait for a person. With
 * `apply: false` every action is only logged.
 */
export class GitHubWriter {
  readonly actions: string[] = [];

  constructor(
    private readonly opts: {
      apply: boolean;
      repoDir: string;
      log?: (line: string) => void;
      run?: Runner;
      /**
       * Token for issue and label commands (GH_ISSUES_TOKEN; the workflow's built-in token in CI).
       * PRs need SEED_PR_TOKEN so that CI runs on them; issues do not, and the scheduled run of
       * 2026-10-19 showed that token may lack Issues: write.
       */
      issuesToken?: string;
    },
  ) {}

  private log(line: string): void {
    this.actions.push(line);
    (this.opts.log ?? console.log)(`${this.opts.apply ? '' : '[dry run] '}${line}`);
  }

  private gh(args: string[]): Promise<string> {
    const issues = (args[0] === 'issue' || args[0] === 'label') && this.opts.issuesToken;
    return (this.opts.run ?? defaultRunner)('gh', args, this.opts.repoDir, issues ? { GH_TOKEN: this.opts.issuesToken! } : undefined);
  }

  private git(args: string[], cwd = this.opts.repoDir): Promise<string> {
    return (this.opts.run ?? defaultRunner)('git', args, cwd);
  }

  async ensureLabels(): Promise<void> {
    if (!this.opts.apply) return;
    const colors: Record<string, string> = { [LABELS.bot]: 'ededed', [LABELS.A]: '0e8a16', [LABELS.B]: 'fbca04', [LABELS.conflict]: 'd93f0b', [LABELS.firstMapping]: '7057ff', [LABELS.tracker]: '1d76db', [LABELS.botFailure]: 'b60205', seed: 'c5def5' };
    for (const [name, color] of Object.entries(colors)) await this.gh(['label', 'create', name, '--color', color, '--force']);
  }

  /**
   * The open issue with exactly this title. Matched by title alone, never by label: the first
   * live run created its issues without labels, and a label filter would have opened them again.
   */
  private async findIssue(title: string): Promise<{ number: number; labels: string[] } | null> {
    const list = JSON.parse(await this.gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,labels'])) as { number: number; title: string; labels: { name: string }[] }[];
    const hit = list.find((i) => i.title === title);
    return hit ? { number: hit.number, labels: hit.labels.map((l) => l.name) } : null;
  }

  /** Adds missing labels and checks they stuck; `gh issue create --label` dropped them silently in CI. */
  private async ensureIssueLabels(ref: string, want: string[], have: string[]): Promise<void> {
    const missing = want.filter((l) => !have.includes(l));
    if (missing.length === 0) return;
    await this.gh(['issue', 'edit', ref, '--add-label', missing.join(',')]);
    const now = JSON.parse(await this.gh(['issue', 'view', ref, '--json', 'labels'])) as { labels: { name: string }[] };
    const still = missing.filter((l) => !now.labels.some((x) => x.name === l));
    if (still.length > 0) this.log(`could not label ${ref} with ${still.join(', ')}`);
  }

  /** Creates the issue, or rewrites the body of the open one with the same title. Returns its URL (or a placeholder in dry run). */
  async upsertIssue(title: string, body: string, labels: string[], opts: { pin?: boolean } = {}): Promise<string> {
    if (!this.opts.apply) {
      this.log(`issue "${title}" [${labels.join(', ')}]`);
      return `(dry run) ${title}`;
    }
    const existing = await this.findIssue(title);
    const file = await tempFile(body);
    try {
      let url: string;
      let have: string[] = [];
      if (existing !== null) {
        await this.gh(['issue', 'edit', String(existing.number), '--body-file', file]);
        url = await this.gh(['issue', 'view', String(existing.number), '--json', 'url', '--jq', '.url']);
        have = existing.labels;
        this.log(`updated issue #${existing.number} "${title}"`);
      } else {
        url = await this.gh(['issue', 'create', '--title', title, '--body-file', file]);
        this.log(`opened issue ${url} "${title}"`);
      }
      await this.ensureIssueLabels(url, labels, have);
      if (opts.pin) {
        const pinned = (JSON.parse(await this.gh(['issue', 'view', url, '--json', 'isPinned'])) as { isPinned?: boolean }).isPinned;
        if (!pinned) await this.gh(['issue', 'pin', url]).catch((err: Error) => this.log(`could not pin ${url}: ${err.message.split('\n').filter(Boolean).pop()}`));
      }
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
    // An explicit refspec: actions/checkout makes a shallow clone that may not track origin/main.
    await this.git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
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
