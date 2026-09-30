const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepare, verify, finalize } = require('../../scripts/release-provenance');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-provenance-'));
  const repo = path.join(root, 'repo');
  const buildContext = path.join(root, 'build');
  fs.mkdirSync(repo);
  fs.mkdirSync(buildContext);
  execFileSync('git', ['-C', repo, 'init', '-q']);
  fs.writeFileSync(path.join(repo, 'source.txt'), 'source\n');
  execFileSync('git', ['-C', repo, 'add', 'source.txt']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const sourceCommit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(buildContext, 'runtime-build.json'), JSON.stringify({ sourceCommit, declaredTargetProjectId: 'asmhysidbg5g', environment: 'staging' }));
  fs.writeFileSync(path.join(buildContext, 'app.js'), 'console.log("ready");\n');
  return { root, repo, buildContext, sourceCommit, manifestPath: path.join(root, 'manifest.json') };
}
function cleanup(f) { fs.rmSync(f.root, { recursive: true, force: true }); }

test('prepares a reproducible exact build-input manifest and detects drift', () => {
  const f = fixture();
  try {
    const manifest = prepare({ repo: f.repo, buildContext: f.buildContext, output: f.manifestPath, project: 'asmhysidbg5g', environment: 'staging' });
    assert.equal(manifest.sourceCommit, f.sourceCommit);
    assert.equal(manifest.platformReleaseBinding, 'NOT_VERIFIED');
    assert.equal(manifest.fileCount, 2);
    assert.match(verify({ manifestPath: f.manifestPath, buildContext: f.buildContext }).buildContextDigest, /^sha256:[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(f.buildContext, 'app.js'), 'changed');
    assert.throws(() => verify({ manifestPath: f.manifestPath, buildContext: f.buildContext }), /BUILD_CONTEXT_DRIFT/);
  } finally { cleanup(f); }
});

test('rejects target mismatch, dirty source and sensitive files', () => {
  const f = fixture();
  try {
    const options = { repo: f.repo, buildContext: f.buildContext, output: f.manifestPath, project: 'asmhysidbg5g', environment: 'staging' };
    assert.throws(() => prepare({ ...options, project: 'g8o5cv1om41o' }), /BUILD_TARGET_MISMATCH/);
    fs.writeFileSync(path.join(f.buildContext, 'runtime-build.json'), JSON.stringify({ sourceCommit: f.sourceCommit, commitSha: '0'.repeat(40), declaredTargetProjectId: 'asmhysidbg5g', environment: 'staging' }));
    assert.throws(() => prepare(options), /BUILD_SOURCE_MISMATCH/);
    fs.writeFileSync(path.join(f.buildContext, 'runtime-build.json'), JSON.stringify({ sourceCommit: f.sourceCommit, declaredTargetProjectId: 'asmhysidbg5g', environment: 'staging' }));
    fs.writeFileSync(path.join(f.repo, 'untracked.txt'), 'x');
    assert.throws(() => prepare(options), /SOURCE_REPO_NOT_CLEAN/);
    fs.unlinkSync(path.join(f.repo, 'untracked.txt'));
    fs.writeFileSync(path.join(f.buildContext, '.env'), 'do not package');
    assert.throws(() => prepare(options), /SENSITIVE_FILENAME_IN_BUILD_CONTEXT/);
  } finally { cleanup(f); }
});

test('records only an observed active release and preserves the platform binding gap', () => {
  const f = fixture();
  try {
    prepare({ repo: f.repo, buildContext: f.buildContext, output: f.manifestPath, project: 'asmhysidbg5g', environment: 'staging' });
    const listing = path.join(f.root, 'releases.json');
    const output = path.join(f.root, 'receipt.json');
    fs.writeFileSync(listing, JSON.stringify({ success: true, data: { versions: [{ version: 70, status: 'SUCCESS', isActive: true, commitId: '', createdAt: new Date(Date.now() + 60000).toISOString() }] } }));
    const receipt = finalize({ manifestPath: f.manifestPath, releaseListPath: listing, releaseVersion: '70', output });
    assert.equal(receipt.sourceCommit, f.sourceCommit);
    assert.equal(receipt.platformReleaseToArtifactBinding, 'NOT_VERIFIED');
    assert.equal(receipt.releaseVersion, 70);
    assert.throws(() => finalize({ manifestPath: f.manifestPath, releaseListPath: listing, releaseVersion: '71', output: path.join(f.root, 'bad.json') }), /ACTIVE_RELEASE_MISMATCH/);
    fs.writeFileSync(listing, JSON.stringify({ success: true, data: { versions: [{ version: 70, status: 'SUCCESS', isActive: true, commitId: '', createdAt: '2020-01-01T00:00:00Z' }] } }));
    assert.throws(() => finalize({ manifestPath: f.manifestPath, releaseListPath: listing, releaseVersion: '70', output: path.join(f.root, 'old.json') }), /RELEASE_PREDATES_MANIFEST/);
  } finally { cleanup(f); }
});
