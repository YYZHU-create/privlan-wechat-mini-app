"""Generate machine-local project memory configuration from explicit inputs."""
import argparse
import json
from pathlib import Path
import re

MODEL_REPOSITORY='Qdrant/bge-small-zh-v1.5'
MODEL_REVISION='46fbe35fd4374a00fee7de77dfddaeb6dd6a2c59'


def configure(project_root,vault,output,model_dir=None,download_model=False,force=False):
    project_root=Path(project_root).resolve()
    vault=Path(vault).resolve()
    output=Path(output).resolve()
    if not project_root.is_dir():
        raise ValueError('PROJECT_DIRECTORY_REQUIRED')
    if output.exists() and not force:
        raise FileExistsError('CONFIG_EXISTS: explicitly select --force to replace')
    runtime=output.parent.parent/'runtime'
    config={'project':'FEELDAO OS','vault':str(vault),'cache':str(runtime/'cache'),
            'sources':[{'root':str(project_root),'patterns':['docs/context/*.md','docs/tasks/*.md'],'label':'project'}],
            'github':{'repository':'YYZHU-create/privlan-wechat-mini-app',
                      'url':'https://github.com/YYZHU-create/privlan-wechat-mini-app.git',
                      'branches':['codex/production-startup-guard'],'timeout_seconds':90,'max_file_bytes':262144}}
    if download_model:
        from huggingface_hub import snapshot_download
        model_dir=snapshot_download(MODEL_REPOSITORY,revision=MODEL_REVISION,
                                   cache_dir=runtime/'models',allow_patterns=['*.json','*.txt','*.onnx','onnx/*'])
    if model_dir:
        path=Path(model_dir).resolve()
        if not path.is_dir() or not (path/'model_optimized.onnx').exists():
            raise ValueError('MODEL_DIRECTORY_NOT_READY')
        config['model']={'name':'BAAI/bge-small-zh-v1.5','dimensions':512,'threads':4,
                         'repository':MODEL_REPOSITORY,'revision':MODEL_REVISION,'path':str(path)}
    output.parent.mkdir(parents=True,exist_ok=True)
    pending=output.with_suffix('.pending')
    pending.write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
    pending.replace(output)
    return config


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root',type=Path,required=True)
    parser.add_argument('--vault',type=Path,required=True)
    parser.add_argument('--config-output',type=Path,default=Path(__file__).with_name('config.json'))
    parser.add_argument('--model-dir',type=Path)
    parser.add_argument('--download-model',action='store_true')
    parser.add_argument('--force',action='store_true')
    args=parser.parse_args()
    config=configure(args.project_root,args.vault,args.config_output,args.model_dir,args.download_model,args.force)
    print('LOCAL_CONFIG_CREATED')
    print('MODEL_MODE='+('LOCAL_ONNX' if 'model' in config else 'KEYWORD'))


if __name__=='__main__':
    main()
