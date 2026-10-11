import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReply} from '../lib/mico/core.mjs';
import {executePublish,loadPluginConfigs,savePluginConfigs} from '../lib/mico/plugins.ts';

test('agent validateReply accepts valid publish actions', () => {
  const reply = validateReply(JSON.stringify({
    message: 'Deploying site to Vercel',
    actions: [{type: 'publish', target: 'vercel'}],
    done: false
  }));
  assert.equal(reply.actions[0].type, 'publish');
  assert.equal(reply.actions[0].target, 'vercel');

  const ghReply = validateReply(JSON.stringify({
    message: 'Pushing to GitHub',
    actions: [{type: 'publish', target: 'github', repo: 'my-site', message: 'Initial commit'}],
    done: false
  }));
  assert.equal(ghReply.actions[0].type, 'publish');
  assert.equal(ghReply.actions[0].target, 'github');
  assert.equal(ghReply.actions[0].repo, 'my-site');

  // Unknown target must throw
  assert.throws(() => validateReply(JSON.stringify({
    message: 'invalid target',
    actions: [{type: 'publish', target: 'unknown_host'}],
    done: false
  })));
});

test('executePublish validates tokens and returns structured result', async () => {
  const res = await executePublish({
    target: 'github',
    files: {'index.html': '<h1>Hi</h1>'},
    projectName: 'test-project',
    token: ''
  });
  assert.equal(res.success, false);
  assert.match(res.message, /GitHub Personal Access Token is required/);

  const vercelRes = await executePublish({
    target: 'vercel',
    files: {'index.html': '<h1>Hi</h1>'},
    projectName: 'test-project',
    token: ''
  });
  assert.equal(vercelRes.success, false);
  assert.match(vercelRes.message, /Vercel API token is required/);
});

test('executePublish handles custom webhook endpoints', async () => {
  const res = await executePublish({
    target: 'custom',
    files: {'index.html': '<h1>Hi</h1>'},
    projectName: 'test-project'
  });
  assert.equal(res.success, false);
  assert.match(res.message, /endpoint URL is not configured/);
});

test('loadPluginConfigs returns default providers', () => {
  const configs = loadPluginConfigs();
  assert.ok(configs.github);
  assert.ok(configs.vercel);
  assert.ok(configs.netlify);
  assert.ok(configs.custom);
  assert.equal(configs.github.name, 'GitHub');
  assert.equal(configs.vercel.name, 'Vercel');
  assert.equal(configs.netlify.name, 'Netlify');
});
