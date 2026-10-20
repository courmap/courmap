import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitHubWriter, type Runner } from '../src/github.js';

// The PR writer against a real git remote (a local bare repo) with a fake gh, so the branch,
// commit and push steps run for real and every gh call is recorded.
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-gh-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('GitHubWriter', () => {
  const remote = path.join(tmp, 'remote.git');
  const work = path.join(tmp, 'work');
  git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
  git(tmp, 'clone', '--quiet', remote, work);
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'test');
  writeFileSync(path.join(work, 'README'), 'x\n');
  git(work, 'add', 'README');
  git(work, 'commit', '--quiet', '-m', 'init');
  git(work, 'push', '--quiet', 'origin', 'main');

  const ghCalls: string[][] = [];
  let openPr = '';
  const run: Runner = async (cmd, args, cwd) => {
    if (cmd === 'git') return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    ghCalls.push(args);
    if (args[0] === 'pr' && args[1] === 'list') return openPr;
    if (args[0] === 'pr' && args[1] === 'create') return (openPr = 'https://github.com/x/y/pull/1');
    return '';
  };
  const writer = new GitHubWriter({ apply: true, repoDir: work, run, log: () => {} });
  const files = new Map([['data/seeds/airing.jsonl', '{"work":"a"}\n']]);

  it('pushes one commit on top of main and opens the PR, leaving the checkout alone', async () => {
    const url = await writer.upsertPullRequest('bots/airing-updates', 'Airing updates for 1 work', 'body', ['bot', 'auto'], files);
    expect(url).toBe('https://github.com/x/y/pull/1');
    expect(git(remote, 'show', 'bots/airing-updates:data/seeds/airing.jsonl')).toBe('{"work":"a"}');
    expect(git(remote, 'log', '--format=%s', 'bots/airing-updates')).toBe('Airing updates for 1 work\ninit');
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(ghCalls.find((c) => c[1] === 'create')).toEqual(expect.arrayContaining(['--label', 'auto']));
    expect(ghCalls.some((c) => c.includes('merge'))).toBe(false);
  });

  it('updates the open PR without pushing when the content is the same', async () => {
    const before = git(remote, 'rev-parse', 'bots/airing-updates');
    await writer.upsertPullRequest('bots/airing-updates', 'Airing updates for 1 work', 'new body', ['bot', 'auto'], files);
    expect(git(remote, 'rev-parse', 'bots/airing-updates')).toBe(before);
    expect(ghCalls.at(-1)!.slice(0, 2)).toEqual(['pr', 'edit']);
  });

  it('skips a PR whose content main already has', async () => {
    const calls = ghCalls.length;
    expect(await writer.upsertPullRequest('bots/noop', 'Nothing', 'b', ['bot'], new Map([['README', 'x\n']]))).toBeNull();
    expect(ghCalls.length).toBe(calls);
  });

  it('opens an issue once, labels it, then finds it by title (not label) and rewrites it', async () => {
    const issues: { number: number; title: string; labels: { name: string }[] }[] = [];
    const calls: string[][] = [];
    const ghIssues: Runner = async (cmd, args) => {
      if (cmd === 'git') return '';
      calls.push(args);
      const [, sub] = args;
      if (sub === 'list') return JSON.stringify(issues);
      if (sub === 'create') {
        // As in the first live run: created without labels.
        issues.push({ number: 7, title: args[args.indexOf('--title') + 1]!, labels: [] });
        return 'https://github.com/x/y/issues/7';
      }
      if (sub === 'edit' && args.includes('--add-label')) {
        issues[0]!.labels.push(...args[args.indexOf('--add-label') + 1]!.split(',').map((name) => ({ name })));
        return '';
      }
      if (sub === 'view' && args.includes('labels')) return JSON.stringify({ labels: issues[0]!.labels });
      if (sub === 'view' && args.includes('isPinned')) return JSON.stringify({ isPinned: calls.some((c) => c[1] === 'pin') });
      if (sub === 'view') return 'https://github.com/x/y/issues/7';
      return '';
    };
    const w = new GitHubWriter({ apply: true, repoDir: work, run: ghIssues, log: () => {} });
    await w.upsertIssue('Season tracker: Fall 2026', 'one', ['bot', 'season-tracker'], { pin: true });
    await w.upsertIssue('Season tracker: Fall 2026', 'two', ['bot', 'season-tracker'], { pin: true });
    expect(calls.map((c) => c.slice(0, 2).join(' '))).toEqual([
      'issue list', 'issue create', 'issue edit', 'issue view', 'issue view', 'issue pin',
      'issue list', 'issue edit', 'issue view', 'issue view',
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.labels.map((l) => l.name)).toEqual(['bot', 'season-tracker']);
    expect(calls[0]).not.toContain('--label');
  });

  it('lists open issues by title prefix and closes one with a comment, only when applying', async () => {
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      return args[1] === 'list' ? JSON.stringify([{ number: 4, title: 'TMDB projection mismatch: a' }, { number: 5, title: 'Count conflict: a' }]) : '';
    };
    const w = new GitHubWriter({ apply: true, repoDir: work, run, log: () => {} });
    expect(await w.openIssues('TMDB projection mismatch: ')).toEqual([{ number: 4, title: 'TMDB projection mismatch: a' }]);
    await w.closeIssue(4, 'why');
    expect(calls[1]).toEqual(['issue', 'close', '4', '--comment', 'why']);
    const dry = new GitHubWriter({ apply: false, repoDir: work, run, log: () => {} });
    await dry.closeIssue(4, 'why');
    expect(calls).toHaveLength(2);
  });

  it('runs issue and label commands with the issues token and everything else with the default', async () => {
    const seen: string[] = [];
    const run: Runner = async (cmd, args, _cwd, env) => {
      seen.push(`${cmd} ${args[0]} ${env?.GH_TOKEN ?? 'default'}`);
      if (args[1] === 'list') return '[]';
      if (args.includes('isPinned')) return JSON.stringify({ isPinned: true });
      if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'bot' }] });
      if (cmd === 'git' && args[0] === 'diff') return 'data/seeds/airing.jsonl';
      return cmd === 'gh' && args[1] === 'create' ? 'https://github.com/x/y/issues/7' : '';
    };
    const w = new GitHubWriter({ apply: true, repoDir: work, run, log: () => {}, issuesToken: 'issues-token' });
    await w.ensureLabels();
    await w.upsertIssue('T', 'b', ['bot'], { pin: true });
    await w.upsertPullRequest('bots/y', 'T', 'b', ['bot'], files);
    expect([...new Set(seen)].sort()).toEqual(['gh label issues-token', 'gh issue issues-token', 'git fetch default', 'git worktree default', 'git add default', 'git diff default', 'git ls-remote default', 'git push default', 'git -c default', 'gh pr default'].sort());
  });

  it('only logs in dry run', async () => {
    const lines: string[] = [];
    const dry = new GitHubWriter({ apply: false, repoDir: work, run: async () => { throw new Error('no commands in dry run'); }, log: (l) => lines.push(l) });
    await dry.upsertPullRequest('bots/x', 'T', 'b', ['bot'], files);
    await dry.upsertIssue('Season tracker: Fall 2026', 'b', ['bot', 'season-tracker']);
    expect(lines).toEqual(['[dry run] PR bots/x "T" [bot]: data/seeds/airing.jsonl', '[dry run] issue "Season tracker: Fall 2026" [bot, season-tracker]']);
  });
});
