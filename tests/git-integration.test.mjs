import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {extractJsonFromText, validateReply} from '../lib/mico/core.mjs';
import {readModelText} from '../lib/mico/response-reader.mjs';
import {
  isGitAvailable,
  gitStatus,
  gitInit,
  gitCommit,
  gitLog,
  gitBranch,
  gitDiff
} from '../desktop/git.mjs';

test('extractJsonFromText strips thinking tags from frontier reasoning models', () => {
  const deepseek = `<think>
I need to examine the project files and write index.html.
Let's see what is needed.
</think>
{"message":"Writing initial page","actions":[{"type":"write_file","path":"index.html","content":"<!DOCTYPE html><html><body><h1>Hello</h1></body></html>"}],"done":false}`;

  const clean = extractJsonFromText(deepseek);
  const parsed = JSON.parse(clean);
  assert.equal(parsed.message, 'Writing initial page');
  assert.equal(parsed.actions[0].path, 'index.html');
  assert.equal(parsed.done, false);
});

test('extractJsonFromText strips markdown code fences and conversational preamble', () => {
  const reply = `Sure! Here is the plan and the action:
\`\`\`json
{
  "message": "Project check complete",
  "actions": [{"type": "check_project"}],
  "done": true
}
\`\`\`
Let me know if you need anything else!`;

  const clean = extractJsonFromText(reply);
  const parsed = JSON.parse(clean);
  assert.equal(parsed.message, 'Project check complete');
  assert.equal(parsed.actions[0].type, 'check_project');
  assert.equal(parsed.done, true);
});

test('validateReply supports native git actions', () => {
  const validStatus = validateReply(JSON.stringify({
    message: 'Checking git status',
    actions: [{type: 'git', command: 'status'}],
    done: false
  }));
  assert.equal(validStatus.actions[0].type, 'git');
  assert.equal(validStatus.actions[0].command, 'status');

  const validCommit = validateReply(JSON.stringify({
    message: 'Committing staged changes',
    actions: [{type: 'git', command: 'commit', message: 'feat: add home page'}],
    done: true
  }));
  assert.equal(validCommit.actions[0].command, 'commit');
  assert.equal(validCommit.actions[0].message, 'feat: add home page');

  assert.throws(() => validateReply(JSON.stringify({
    message: 'Invalid git action',
    actions: [{type: 'git', command: 'rebase-interactive-hack'}],
    done: false
  })), /Unsupported git command/);
});

test('readModelText never treats reasoning_content as an agent action', async () => {
  const reasoningObj = {
    choices: [{
      message: {
        content: '',
        reasoning_content: '{"message":"Thinking done","actions":[],"done":true}'
      }
    }]
  };
  let reasoning = '';
  await assert.rejects(readModelText(Response.json(reasoningObj), {onReasoning: value => { reasoning = value; }}), /no assistant text/);
  assert.equal(reasoning, '{"message":"Thinking done","actions":[],"done":true}');
});

test('desktop git functions work on temporary repositories', async () => {
  const avail = await isGitAvailable();
  if (!avail) {
    // If Git is not installed in the test environment, skip repo tests
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mico-git-test-'));
  try {
    // Before init: not a repo
    const notRepoStatus = await gitStatus(tmpDir);
    assert.equal(notRepoStatus.isRepo, false);

    // Init
    const initRes = await gitInit(tmpDir);
    assert.equal(initRes.success, true);

    // Status after init
    const afterInit = await gitStatus(tmpDir);
    assert.equal(afterInit.isRepo, true);

    // Create a file
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello git\n', 'utf8');

    const statusWithFile = await gitStatus(tmpDir);
    assert.ok(statusWithFile.untracked.includes('test.txt'));

    // Commit
    const commitRes = await gitCommit(tmpDir, 'Initial commit');
    assert.equal(commitRes.success, true);

    // Status after commit: clean
    const cleanStatus = await gitStatus(tmpDir);
    assert.equal(cleanStatus.clean, true);

    // Log
    const log = await gitLog(tmpDir, 5);
    assert.ok(log.length > 0);
    assert.equal(log[0].message, 'Initial commit');

    // Branches
    const branches = await gitBranch(tmpDir);
    assert.ok(branches.branches.length > 0);

    // Modify file
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello git modified\n', 'utf8');
    const diff = await gitDiff(tmpDir);
    assert.ok(diff.includes('hello git modified'));
  } finally {
    await fs.rm(tmpDir, {recursive: true, force: true}).catch(() => {});
  }
});
