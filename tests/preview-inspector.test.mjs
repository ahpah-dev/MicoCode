import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const readRepoFile = rel => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

test('preview component and visual styles include inspector and console drawer definitions', () => {
 const visualCss = readRepoFile('app/visual.css');
 assert.ok(visualCss.includes('.preview-inspect-btn'), 'visual.css must define .preview-inspect-btn');
 assert.ok(visualCss.includes('.preview-console-drawer'), 'visual.css must define .preview-console-drawer');
 assert.ok(visualCss.includes('.preview-badge.error'), 'visual.css must define .preview-badge.error');
 assert.ok(visualCss.includes('.preview-fix-btn'), 'visual.css must define .preview-fix-btn');
 assert.ok(visualCss.includes('.preview-inspect-banner'), 'visual.css must define .preview-inspect-banner');
});

test('preview component script generates inspector overlay and postMessage dispatch', () => {
 const previewCode = readRepoFile('components/micocode/preview.tsx');
 assert.ok(previewCode.includes('__mico_inspector_overlay'), 'preview must define inspector overlay');
 assert.ok(previewCode.includes('__mico_inspector_badge'), 'preview must define inspector badge');
 assert.ok(previewCode.includes('mico-element-selected'), 'preview must dispatch mico-element-selected');
 assert.ok(previewCode.includes('mico-inspect-cancelled'), 'preview must handle mico-inspect-cancelled');
 assert.ok(previewCode.includes('onTargetElement'), 'preview must support onTargetElement prop');
 assert.ok(previewCode.includes('onFixError'), 'preview must support onFixError prop');
});

test('workspace component wires element inspector and error fix actions to Mico', () => {
 const workspaceCode = readRepoFile('components/micocode/workspace.tsx');
 assert.ok(workspaceCode.includes('handleTargetElement'), 'workspace must define handleTargetElement');
 assert.ok(workspaceCode.includes('handleFixError'), 'workspace must define handleFixError');
 assert.ok(workspaceCode.includes('onTargetElement={handleTargetElement}'), 'workspace must pass onTargetElement to Preview');
 assert.ok(workspaceCode.includes('onFixError={handleFixError}'), 'workspace must pass onFixError to Preview');
 assert.ok(workspaceCode.includes('Fix this preview runtime error'), 'Fix error prompt must include runtime error context');
});
