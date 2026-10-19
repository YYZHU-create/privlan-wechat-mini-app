// Isolated local editor: copy repository assets once; never inherit cloud credentials.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const home = process.env.LOCAL_EDITOR_HOME || path.join(process.env.LOCALAPPDATA, 'FeelDao', 'local-editor');
const root = path.resolve(home, 'project');
fs.mkdirSync(root, { recursive: true });
function seed(relative) {
  const from = path.join(source, relative), to = path.join(root, relative);
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  }
}
for (const item of ['images', 'fonts', 'pages', 'components', 'custom-tab-bar', 'utils', 'source', 'app.js', 'app.json', 'app.wxss', 'project.config.json', 'sitemap.json', 'admin/config.json']) seed(item);
// Generated service configuration is part of the sync contract; seed only
// its required files, not credentials or installed cloud-function dependencies.
seed('cloudfunctions/serviceQuery/store-config.js');
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: process.env.LOCAL_EDITOR_PORT || '63159',
  PRIVLAN_ROOT: root, PRIVLAN_CONFIG_PATH: path.join(root, 'admin/config.json'),
  PRIVLAN_IMAGES_DIR: path.join(root, 'images'), PRIVLAN_FONTS_DIR: path.join(root, 'fonts'),
  PRIVLAN_CONFIG_BACKUP_DIR: path.join(home, 'config-backups'),
  PRIVLAN_MEDIA_FOLDERS_PATH: path.join(home, 'media-folders.json'),
  PRIVLAN_MEDIA_TRASH_DIR: path.join(home, 'media-trash'),
  PRIVLAN_PREVIEW_ROOT_BASE: path.join(home, 'preview'), PRIVLAN_PREVIEW_QR_PATH: path.join(home, 'preview-qr.png'),
  ATELIER_DATA_ROOT: path.join(home, 'data'), ATELIER_STATE_PATH: path.join(home, 'saas-state.json'),
  ATELIER_MASTER_KEY_PATH: path.join(home, 'local-master-key'), PRIVLAN_OPS_BOOTSTRAP_PATH: path.join(home, 'ops-bootstrap.json'),
  ATELIER_RUNTIME_CONFIG_PATH: path.join(home, 'unused-runtime-config.json'),
  PRIVLAN_DISABLE_GIT_SYNC: '1', ATELIER_AUTO_MIGRATE: 'false'
});
console.log('LOCAL_EDITOR_DIRECTORY=' + home);
console.log('LOCAL_EDITOR_URL=http://127.0.0.1:' + env.PORT + '/?view=editor');
const boot = `
const {app}=require(${JSON.stringify(path.join(source, 'admin/server.js'))});
app.get('/auth/session',(req,res)=>res.json({ok:true,data:{user:{id:'local-editor',login:'local-editor@localhost',displayName:'本地开发'},workspace:{id:'local-workspace',tenantId:'local-tenant',name:'本地开发副本'},role:'owner'}}));
const layer=app._router.stack.pop();app._router.stack.splice(2,0,layer);
`;
const child = spawn(process.execPath, ['-e', boot], { env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
