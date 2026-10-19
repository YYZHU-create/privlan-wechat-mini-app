import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('memory', Path(__file__).with_name('memory.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.vault = self.root / 'vault'
        self.config = {'project': 'FEELDAO OS', 'vault': str(self.vault), 'sources': [
            {'root': str(self.source), 'patterns': ['*.md'], 'label': 'fixture'}]}
        self.doc = self.source / 'launch.md'
        self.doc.write_text('# 发布记录\nStaging v72 启动配置交付失败。\nProduction 尚待恢复验证。\n', encoding='utf-8')

    def index(self):
        m.sync(self.config)
        return m.build_index(self.config)

    def test_chinese_retrieval_and_source_lines(self):
        result = m.retrieve(self.index(), '发布配置', 2)
        self.assertTrue(result)
        self.assertEqual(result[0]['source_path'], str(self.doc.resolve()))
        self.assertEqual(result[0]['line_start'], 1)
        self.assertIn('Staging v72', result[0]['text'])
        self.assertEqual(result[0]['source_sha256'], m.digest(self.doc.read_bytes()))

    def test_source_update_is_visible(self):
        self.index()
        self.doc.write_text('# 发布记录\nREVISED_MARKER configuration delivery repaired\n', encoding='utf-8')
        self.assertTrue(m.retrieve(self.index(), 'REVISED_MARKER'))

    def test_deleted_source_is_removed(self):
        self.index()
        self.doc.unlink()
        self.assertEqual(self.index()['chunks'], [])

    def test_manual_mirror_changes_preserved(self):
        self.index()
        mirror = next((self.vault / '80-Sources').rglob('*.md'))
        mirror.chmod(0o644)
        mirror.write_text('human edited content', encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, 'MIRROR_EDIT_CONFLICT'):
            self.index()
        self.assertEqual(mirror.read_text('utf-8'), 'human edited content')

    def test_secret_material_redacted(self):
        secret = 'x' * 24
        self.doc.write_text('# fixture\npassword=' + secret + '\n-----BEGIN PRIVATE KEY-----\nPRIVATE_DATA\n-----END PRIVATE KEY-----\n', encoding='utf-8')
        index = self.index()
        text = json.dumps(index)
        self.assertNotIn(secret, text)
        self.assertNotIn('PRIVATE_DATA', text)
        self.assertIn('REDACTED', text)

    def test_empty_query_returns_no_evidence(self):
        self.assertEqual(m.retrieve(self.index(), ''), [])

    def test_unrelated_query_returns_no_evidence(self):
        self.assertEqual(m.retrieve(self.index(), 'zzzzunrelatedxyz'), [])
        self.assertIn('NO_EVIDENCE', m.rag_packet('zzzzunrelatedxyz', []))

    def test_record_is_retrievable_and_unique(self):
        self.index()
        body = self.root / 'body.txt'
        body.write_text('单位测试通过；证据 artifact/test.txt。WRITEBACK_MARKER', encoding='utf-8')
        args = argparse.Namespace(title='检索写回验证', body_file=str(body), domain='Governance', thread='fixture-thread', status='completed')
        first = m.record(self.config, args)
        second = m.record(self.config, args)
        self.assertNotEqual(first, second)
        self.assertTrue(m.retrieve(self.index(), 'WRITEBACK_MARKER'))

    def test_superseded_record_excluded(self):
        self.index()
        note = self.vault / '30-Events' / 'old.md'
        note.parent.mkdir()
        note.write_text('---\nstatus: superseded\n---\nOLD_MARKER', encoding='utf-8')
        self.assertEqual(m.retrieve(self.index(), 'OLD_MARKER'), [])

    def test_record_secret_rejected(self):
        self.index()
        body = self.root / 'body.txt'
        body.write_text('password=' + 'x' * 24, encoding='utf-8')
        args = argparse.Namespace(title='record', body_file=str(body), domain='Governance', thread='fixture-thread', status='completed')
        with self.assertRaisesRegex(ValueError, 'SENSITIVE_INPUT'):
            m.record(self.config, args)
        self.assertFalse((self.vault / '30-Events').exists())

    def test_lock_serializes_writes(self):
        with m.lock(self.vault):
            self.assertTrue((self.vault / '.rag/write.lock').exists())
        self.assertFalse((self.vault / '.rag/write.lock').exists())

    def test_path_escape_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PATH_OUTSIDE_VAULT'):
            m.safe_child(self.vault, '../outside.md')

    def test_rag_packet_separates_evidence_and_instructions(self):
        results = m.retrieve(self.index(), '发布')
        packet = m.rag_packet('发布', results)
        self.assertIn('untrusted data', packet)
        self.assertIn('## E1', packet)
        self.assertIn('source_sha256', packet)
        self.assertIn('runtime not reverified', packet)


if __name__ == '__main__':
    unittest.main(verbosity=2)
