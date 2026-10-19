import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from configure import configure


class ConfigureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.project=self.root/'project'
        self.project.mkdir()
        self.output=self.root/'skill/scripts/config.json'

    def test_machine_configuration_is_generated_locally(self):
        config=configure(self.project,self.root/'vault',self.output)
        self.assertEqual(config['sources'][0]['root'],str(self.project.resolve()))
        self.assertEqual(config['vault'],str((self.root/'vault').resolve()))
        self.assertNotIn('model',config)
        self.assertEqual(json.loads(self.output.read_text('utf-8')),config)

    def test_existing_configuration_is_preserved(self):
        configure(self.project,self.root/'vault',self.output)
        before=self.output.read_bytes()
        with self.assertRaises(FileExistsError):
            configure(self.project,self.root/'different',self.output)
        self.assertEqual(self.output.read_bytes(),before)

    def test_missing_model_directory_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'MODEL_DIRECTORY_NOT_READY'):
            configure(self.project,self.root/'vault',self.output,model_dir=self.root/'absent')
        self.assertFalse(self.output.exists())

    def test_generated_state_is_ignored_by_git(self):
        skill=self.root/'skill'
        skill.mkdir()
        shutil.copyfile(Path(__file__).parent.parent/'.gitignore',skill/'.gitignore')
        subprocess.run(['git','init',str(skill)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for relative in ['scripts/config.json','runtime/cache/vectors.npy','runtime/models/model.onnx','.venv/pyvenv.cfg']:
            process=subprocess.run(['git','check-ignore','--no-index',relative],cwd=skill,capture_output=True)
            self.assertEqual(process.returncode,0,relative)


if __name__=='__main__':
    unittest.main()
