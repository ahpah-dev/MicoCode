import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export async function runGit(args, cwd, timeout = 30000) {
  try {
    const {stdout, stderr} = await execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C'
      }
    });
    return {stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8')};
  } catch (error) {
    const message = error.stderr ? error.stderr.toString('utf8').trim() : error.message;
    const err = new Error(message || 'Git command failed.');
    err.code = error.code;
    err.stdout = error.stdout?.toString('utf8');
    err.stderr = error.stderr?.toString('utf8');
    throw err;
  }
}

export async function isGitAvailable() {
  try {
    const {stdout} = await runGit(['--version'], process.cwd());
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function parseGitStatus(output) {
  const lines = output.split(/\r?\n/).filter(line => line.trim().length > 0);
  let branch = 'main';
  let tracking = '';
  let ahead = 0;
  let behind = 0;
  const staged = [];
  const modified = [];
  const untracked = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const header = line.slice(3);
      const parts = header.split('...');
      branch = parts[0]?.trim() || 'HEAD';
      if (parts[1]) {
        const trackingPart = parts[1].split(' ')[0].trim();
        tracking = trackingPart;
      }
      const aheadMatch = header.match(/ahead (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      const behindMatch = header.match(/behind (\d+)/);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
      continue;
    }

    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const file = line.slice(3).trim();

    if (indexStatus === '?' && workTreeStatus === '?') {
      untracked.push(file);
    } else {
      if (['M', 'A', 'D', 'R', 'C'].includes(indexStatus)) {
        staged.push({status: indexStatus, file});
      }
      if (['M', 'D', 'U'].includes(workTreeStatus)) {
        modified.push({status: workTreeStatus, file});
      }
    }
  }

  const clean = staged.length === 0 && modified.length === 0 && untracked.length === 0;
  return {branch, tracking, ahead, behind, staged, modified, untracked, clean};
}

export async function gitStatus(cwd) {
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  } catch {
    return {isRepo: false, branch: '', clean: true, staged: [], modified: [], untracked: [], ahead: 0, behind: 0};
  }

  const {stdout} = await runGit(['status', '--porcelain=v1', '-b'], cwd);
  const parsed = parseGitStatus(stdout);
  let lastCommit = '';
  try {
    const {stdout: logOut} = await runGit(['log', '-n', '1', '--pretty=format:%h - %s (%cr)'], cwd);
    lastCommit = logOut.trim();
  } catch {}

  return {isRepo: true, ...parsed, lastCommit};
}

export async function gitInit(cwd) {
  try {
    await runGit(['init', '-b', 'main'], cwd);
  } catch {
    await runGit(['init'], cwd);
  }
  return {success: true};
}

async function ensureGitIdentity(cwd) {
  let hasEmail = false;
  try {
    const {stdout} = await runGit(['config', 'user.email'], cwd);
    if (stdout.trim()) hasEmail = true;
  } catch {}
  let hasName = false;
  try {
    const {stdout} = await runGit(['config', 'user.name'], cwd);
    if (stdout.trim()) hasName = true;
  } catch {}
  return {hasEmail, hasName};
}

export async function gitCommit(cwd, message, files = null) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('A commit message is required.');
  }
  if (Array.isArray(files) && files.length > 0) {
    await runGit(['add', '--', ...files], cwd);
  } else {
    await runGit(['add', '-A'], cwd);
  }
  const {hasEmail, hasName} = await ensureGitIdentity(cwd);
  const commitArgs = [];
  if (!hasName) commitArgs.push('-c', 'user.name=MicoCode User');
  if (!hasEmail) commitArgs.push('-c', 'user.email=user@micocode.local');
  commitArgs.push('commit', '-m', message.trim());
  const {stdout} = await runGit(commitArgs, cwd);
  return {success: true, message: message.trim(), output: stdout.trim()};
}

export async function gitLog(cwd, max = 20) {
  try {
    const limit = Math.min(100, Math.max(1, Number(max) || 20));
    const {stdout} = await runGit(['log', '-n', String(limit), '--pretty=format:%H%x09%h%x09%an%x09%at%x09%s'], cwd);
    if (!stdout.trim()) return [];
    return stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const [hash, shortHash, author, timestamp, message] = line.split('\t');
      const ts = parseInt(timestamp, 10);
      return {
        hash,
        shortHash,
        author,
        timestamp: Number.isFinite(ts) ? ts * 1000 : Date.now(),
        date: Number.isFinite(ts) ? new Date(ts * 1000).toLocaleString() : '',
        message: message || ''
      };
    });
  } catch {
    return [];
  }
}

export async function gitBranch(cwd) {
  const {stdout} = await runGit(['branch', '--list'], cwd);
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  let current = '';
  const branches = [];
  for (const line of lines) {
    const isCurrent = line.startsWith('*');
    const name = line.replace(/^\*?\s+/, '').trim();
    if (isCurrent) current = name;
    branches.push(name);
  }
  return {current, branches};
}

export async function gitPush(cwd, remote = 'origin', branch = '') {
  const args = ['push'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  const {stdout, stderr} = await runGit(args, cwd, 60000);
  return {success: true, output: (stdout + '\n' + stderr).trim()};
}

export async function gitPull(cwd, remote = 'origin', branch = '') {
  const args = ['pull'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  const {stdout, stderr} = await runGit(args, cwd, 60000);
  return {success: true, output: (stdout + '\n' + stderr).trim()};
}

export async function gitDiff(cwd, file = '') {
  const args = ['diff'];
  if (file) args.push('--', file);
  const {stdout} = await runGit(args, cwd);
  return stdout;
}
