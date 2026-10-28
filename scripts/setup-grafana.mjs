import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const args=process.argv.slice(2);const arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const path=arg('--env-file')||'.env';let text=readFileSync(path,'utf8');
const env=Object.fromEntries(text.split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
function set(key,value){if(new RegExp(`^${key}=.*$`,'m').test(text))text=text.replace(new RegExp(`^${key}=.*$`,'m'),()=>`${key}=${value}`);else text+=`${text.endsWith('\n')?'':'\n'}${key}=${value}\n`;}
for(const key of ['GRAFANA_READER_PASSWORD','GRAFANA_SECRET_KEY'])if(!env[key]||env[key].includes('CHANGE_ME'))set(key,randomBytes(32).toString('hex'));
const root=arg('--root-url')||env.GRAFANA_ROOT_URL||`http://localhost:${env.HTTP_PORT||8080}/grafana/`;
const parsed=new URL(root);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/grafana/'||parsed.search||parsed.hash)throw new Error('Root URL must be http(s)://host[:port]/grafana/');
set('GRAFANA_ROOT_URL',root);writeFileSync(path,text,{mode:0o600});console.log('Grafana local settings ready; secrets retained in the private environment file.');
