"""Read-only remote Git synchronization in a separate bare cache."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

TEXT_EXTENSIONS = {'.md', '.txt', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.vue', '.css', '.html', '.sql', '.py', '.json', '.yml', '.yaml', '.sh', '.ps1'}
EXCLUDED = {'node_modules', 'dist', 'build', 'vendor', 'coverage', 'playwright-report', 'test-results', '.git', '.pnpm-store', '.codex-audit', '.codex-worktrees', 'verification'}


def allowed(path):
    p = Path(path)
    lower = path.lower()
    return (not any(part.startswith('.') or part.lower() in EXCLUDED for part in p.parts)
            and p.suffix.lower() in TEXT_EXTENSIONS and len(p.parts) < 15
            and not any(x in lower for x in ('lock.json', 'lock.yaml', 'package-lock', 'credentials', 'private-key', '.env', '.pem', 'secrets.', 'runtime.env', 'runtime-config.')))


def git(args, cwd=None, timeout=90, data=None):
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never'}
    p = subprocess.run(['git', '-c', 'credential.interactive=never', *args], cwd=cwd, env=env,
                       input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if p.returncode:
        # No stderr echo: transport helpers may include credential-bearing URLs.
        raise RuntimeError(f'GIT_READ_FAILED exit={p.returncode}; command={args[0]}')
    return p.stdout


def now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')


def save(path, obj):
    path.parent.mkdir(exist_ok=True, parents=True)
    tmp = path.with_suffix('.pending')
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, path)


def discover_branches(config):
    branches = set(config['github'].get('branches', []))
    for source in config['sources']:
        for pattern in source['patterns']:
            for file in Path(source['root']).glob(pattern):
                # The boundary excludes /.codex/artifacts local paths.
                branches.update(re.findall(r'(?<![\w./\\])codex/[A-Za-z0-9][A-Za-z0-9._/-]*', file.read_text('utf-8-sig')))
    return sorted({b.rstrip('./') for b in branches if not b.startswith('codex/artifacts/')})


def read_blobs(cache, entries):
    if not entries:
        return []
    data = git(['cat-file', '--batch'], cwd=cache, data=('\n'.join(sha for _, sha in entries)+'\n').encode())
    output, position = [], 0
    for path, sha in entries:
        end = data.index(b'\n', position)
        header = data[position:end].split()
        size = int(header[2])
        body = data[end+1:end+1+size]
        output.append((path, sha, body))
        position = end+size+2
    return output


def sync_remote(config, redact):
    settings = config['github']
    cache_root = Path(config['cache'])
    cache = cache_root / 'github.git'
    state_file, docs_file = cache_root/'remote-state.json', cache_root/'remote-docs.json'
    old = json.loads(state_file.read_text('utf-8')) if state_file.exists() else {}
    prior_docs = json.loads(docs_file.read_text('utf-8')) if docs_file.exists() else []
    status = {**old, 'attempted_at': now(), 'status': 'ERROR'}
    try:
        remote = git(['ls-remote', '--symref', settings['url'], 'HEAD', 'refs/heads/*'], timeout=settings.get('timeout_seconds', 90)).decode()
        heads, default = {}, 'main'
        for line in remote.splitlines():
            if line.startswith('ref: refs/heads/') and line.endswith('\tHEAD'):
                default = line.split('\t')[0][16:]
            else:
                fields = line.split('\t')
                if len(fields)==2 and fields[1].startswith('refs/heads/'):
                    heads[fields[1][11:]] = fields[0]
        selected = sorted({default, *discover_branches(config)})
        existing = {b: heads[b] for b in selected if b in heads}
        if default not in existing:
            raise RuntimeError('DEFAULT_BRANCH_NOT_FOUND')
        if not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            git(['init', '--bare', str(cache)])
        changed = {b: sha for b, sha in existing.items() if old.get('branches', {}).get(b) != sha}
        if changed:
            refs = [f'+refs/heads/{b}:refs/heads/{b}' for b in changed]
            git(['fetch', '--no-tags', '--depth=20', settings['url'], *refs], cwd=cache, timeout=180)
        if not changed and old.get('branches') == existing and old.get('status') == 'OK' and docs_file.exists():
            status = {**old, 'status': 'OK', 'attempted_at': now(), 'checked_at': now(), 'changed_branches': []}
            save(state_file, status)
            return prior_docs, status
        docs = []
        for branch, sha in existing.items():
            # Enumerate metadata before loading blobs, preventing oversized reads.
            listing = git(['ls-tree', '-rl', sha], cwd=cache).decode('utf-8')
            entries = []
            for line in listing.splitlines():
                metadata, path = line.split('\t', 1)
                mode, kind, blob, size = metadata.split()
                if kind == 'blob' and mode != '120000' and allowed(path) and int(size) <= settings.get('max_file_bytes', 262144):
                    entries.append((path, blob))
            for path, blob, raw in read_blobs(cache, entries):
                if b'\0' in raw:
                    continue
                try:
                    text, redacted = redact(raw.decode('utf-8-sig'))
                except UnicodeError:
                    continue
                docs.append({'text': text, 'source_type': 'github', 'repository': settings['repository'],
                             'branch': branch, 'commit_sha': sha, 'source_path': path,
                             'source_sha256': hashlib.sha256(raw).hexdigest(), 'blob_sha': blob,
                             'url': f'https://github.com/{settings["repository"]}/blob/{sha}/{quote(path)}',
                             'evidence': 'GitHub committed source; runtime not verified', 'redacted_lines': redacted})
            log = git(['log', '-20', '--date=iso-strict', '--format=%H%x09%ad%x09%s', sha], cwd=cache).decode('utf-8')
            clean, count = redact(log)
            docs.append({'text': '# Recent commits\n' + clean, 'source_type': 'github-commits', 'repository': settings['repository'],
                         'branch': branch, 'commit_sha': sha, 'source_path': 'git-log', 'source_sha256': hashlib.sha256(log.encode()).hexdigest(),
                         'url': f'https://github.com/{settings["repository"]}/commits/{sha}',
                         'evidence': 'Git commit metadata; runtime not verified', 'redacted_lines': count})
        status = {'status': 'OK', 'attempted_at': now(), 'checked_at': now(), 'default_branch': default,
                  'branches': existing, 'missing_branches': [b for b in selected if b not in heads],
                  'documents': len(docs), 'changed_branches': list(changed), 'error': None}
        save(docs_file, docs)
        save(state_file, status)
        return docs, status
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError) as error:
        status.update({'status': 'ERROR', 'error': type(error).__name__, 'cached_documents': len(prior_docs)})
        save(state_file, status)
        return prior_docs, status


def local_changed_documents(config, redact):
    docs = []
    for source in config['sources']:
        root = Path(source['root'])
        try:
            sha = git(['rev-parse', 'HEAD'], cwd=root).decode().strip()
            branch = git(['branch', '--show-current'], cwd=root).decode().strip()
            tracked = git(['diff', '--name-only', '-z', 'HEAD'], cwd=root).decode().split('\0')
            untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'admin', 'src', 'scripts', 'test', 'tests', 'functions'], cwd=root).decode().split('\0')
        except (RuntimeError, OSError):
            continue
        for relative in sorted(set(tracked+untracked)):
            if not relative or not allowed(relative) or relative.startswith('docs/') or relative == 'AGENTS.md':
                continue
            path = root / relative
            if not path.is_file() or path.is_symlink() or path.stat().st_size > 262144:
                continue
            raw = path.read_bytes()
            try:
                text, count = redact(raw.decode('utf-8-sig'))
            except UnicodeError:
                continue
            docs.append({'text': text, 'source_type': 'local-uncommitted', 'checkout': str(root), 'branch': branch,
                         'commit_sha': sha, 'source_path': str(path), 'source_sha256': hashlib.sha256(raw).hexdigest(),
                         'evidence': 'local uncommitted file; runtime not verified', 'redacted_lines': count})
    return docs
