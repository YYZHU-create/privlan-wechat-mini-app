import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import github_source as g
import memory as m


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root/'remote'
        self.repo.mkdir()
        self.run_git('init','-b','main')
        self.run_git('config','user.email','fixture@example.invalid')
        self.run_git('config','user.name','Fixture')
        self.run_git('config','core.autocrlf','false')
        (self.repo/'README.md').write_text('# 发布记录\nFIXTURE_REVISION_ONE\n', encoding='utf-8')
        (self.repo/'.env').write_text('password=do-not-index-this-fixture', encoding='utf-8')
        self.run_git('add','.')
        self.run_git('commit','-m','fixture one')
        self.vault = self.root/'vault'
        self.config = {'project':'fixture','vault':str(self.vault),'cache':str(self.root/'cache'),
                       'sources':[{'root':str(self.repo),'patterns':['README.md'],'label':'fixture'}],
                       'github':{'repository':'YYZHU-create/privlan-wechat-mini-app','url':str(self.repo),'branches':[]}}

    def run_git(self,*args):
        return subprocess.check_output(['git',*args],cwd=self.repo,stderr=subprocess.DEVNULL).decode().strip()

    def test_actual_remote_commit_change_and_frozen_reference(self):
        first,status=g.sync_remote(self.config,m.redact)
        self.assertEqual(status['status'],'OK')
        sha=status['branches']['main']
        doc=next(d for d in first if d['source_path']=='README.md')
        self.assertIn(sha,doc['url'])
        self.assertEqual(doc['text'],'# 发布记录\nFIXTURE_REVISION_ONE')
        (self.repo/'README.md').write_text('# 发布记录\nFIXTURE_REVISION_TWO\n',encoding='utf-8')
        self.run_git('add','README.md');self.run_git('commit','-m','fixture two')
        second,status=g.sync_remote(self.config,m.redact)
        self.assertNotEqual(sha,status['branches']['main'])
        self.assertTrue(any('FIXTURE_REVISION_TWO' in d['text'] for d in second))
        original=g.git(['show',sha+':README.md'],cwd=Path(self.config['cache'])/'github.git')
        self.assertIn(b'FIXTURE_REVISION_ONE',original)

    def test_network_failure_retains_successful_snapshot(self):
        docs,status=g.sync_remote(self.config,m.redact)
        with patch.object(g,'git',side_effect=RuntimeError('simulated network failure')):
            cached,failed=g.sync_remote(self.config,m.redact)
        self.assertEqual(cached,docs)
        self.assertEqual(failed['status'],'ERROR')
        self.assertEqual(failed['branches'],status['branches'])
        self.assertEqual(failed['checked_at'],status['checked_at'])

    def test_secret_files_and_dependency_directories_excluded(self):
        docs,_=g.sync_remote(self.config,m.redact)
        self.assertFalse(any(d['source_path']=='.env' for d in docs))
        self.assertFalse(g.allowed('node_modules/example/index.js'))
        self.assertFalse(g.allowed('config/credentials.json'))

    def test_branch_discovery_ignores_local_artifact_paths(self):
        (self.repo/'README.md').write_text('Branch: `codex/test-branch`\nC:/.codex/artifacts/one/REPORT.md',encoding='utf-8')
        self.assertEqual(g.discover_branches(self.config),['codex/test-branch'])

    def test_task_branch_verified_and_indexed(self):
        self.run_git('checkout','-b','codex/task')
        (self.repo/'README.md').write_text('# 任务\nBranch `codex/task`\nTASK_ONLY_MARKER',encoding='utf-8')
        self.run_git('add','.');self.run_git('commit','-m','task')
        self.run_git('checkout','main')
        self.config['github']['branches']=['codex/task']
        _,status=g.sync_remote(self.config,m.redact)
        self.assertIn('main',status['branches'])
        self.assertIn('codex/task',status['branches'])

    def test_local_uncommitted_source_is_separate(self):
        (self.repo/'module.py').write_text('LOCAL_ONLY_MARKER=1',encoding='utf-8')
        self.run_git('add','module.py');self.run_git('commit','-m','module')
        (self.repo/'module.py').write_text('LOCAL_ONLY_MARKER=2',encoding='utf-8')
        docs=g.local_changed_documents(self.config,m.redact)
        self.assertEqual(docs[0]['source_type'],'local-uncommitted')
        self.assertIn('=2',docs[0]['text'])
        self.assertEqual(docs[0]['commit_sha'],self.run_git('rev-parse','HEAD'))

    def test_model_failure_is_explicit_lexical_fallback(self):
        del self.config['github']
        self.config['model']={'name':'fixture'}
        path=self.root/'config.json';path.write_text(json.dumps(self.config),encoding='utf-8')
        output=io.StringIO()
        with patch('semantic.ensure_vectors',side_effect=RuntimeError('model failure')),contextlib.redirect_stdout(output):
            m.main(['--config',str(path),'search','发布'])
        result=json.loads(output.getvalue())
        self.assertEqual(result['status']['semantic']['status'],'FAIL')
        self.assertEqual(result['status']['semantic']['fallback'],'BM25')
        self.assertTrue(result['results'])

    def test_source_citation_matches_original_lines_and_hash(self):
        docs,status=g.sync_remote(self.config,m.redact)
        m.sync(self.config)
        index=m.build_index(self.config,docs,status)
        result=next(c for c in index['chunks'] if c['source_type']=='github' and c['source_path']=='README.md')
        raw=(self.repo/'README.md').read_bytes()
        self.assertEqual(result['source_sha256'],m.digest(raw))
        self.assertEqual(result['text'],'\n'.join(raw.decode().splitlines()[result['line_start']-1:result['line_end']]))

    def test_chunk_boundary_bounded_for_long_lines(self):
        meta={'source_path':'long.js','source_sha256':'fixture','evidence':'fixture'}
        chunks=m.chunk_document('x'*2000,meta,'long','long.js')
        self.assertEqual(''.join(c['text'] for c in chunks),'x'*2000)
        self.assertTrue(all(len(c['text'])<=440 and c['line_start']==1 for c in chunks))

    def test_knowledge_frontmatter_and_navigation_not_ranked(self):
        m.sync(self.config)
        note=self.vault/'knowledge.md'
        note.write_text('---\nstatus: active\n---\n# 专项记录\n这是一段真实项目知识内容和验证依据。\n\n[[00-项目总览]]',encoding='utf-8')
        index=m.build_index(self.config)
        chunks=[c for c in index['chunks'] if c['source_path']==str(note)]
        self.assertTrue(chunks)
        self.assertTrue(all(c['line_start']>=4 for c in chunks))
        self.assertFalse(any(c['text'].strip()=='[[00-项目总览]]' for c in chunks))

    def test_removed_remote_task_branch_not_kept_as_current(self):
        self.run_git('branch','codex/task')
        self.config['github']['branches']=['codex/task']
        docs,initial=g.sync_remote(self.config,m.redact)
        self.assertIn('codex/task',initial['branches'])
        self.run_git('branch','-D','codex/task')
        docs,status=g.sync_remote(self.config,m.redact)
        self.assertNotIn('codex/task',status['branches'])
        self.assertIn('codex/task',status['missing_branches'])
        self.assertFalse(any(d.get('branch')=='codex/task' for d in docs))


if __name__=='__main__':
    unittest.main(verbosity=2)
