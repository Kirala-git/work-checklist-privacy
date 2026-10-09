'use strict';

document.documentElement.classList.add('has-js');
const menuButton=document.querySelector('.menu-button');
const nav=document.querySelector('#nav');
menuButton?.addEventListener('click',()=>{
  const open=nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded',String(open));
});
nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
  nav.classList.remove('open');
  menuButton?.setAttribute('aria-expanded','false');
}));

const languageButton=document.querySelector('#language-toggle');
let savedLanguage;
try{savedLanguage=localStorage.getItem('worklist-language');}catch{}
let language=['zh','en'].includes(savedLanguage)?savedLanguage:((navigator.language||'').toLowerCase().startsWith('zh')?'zh':'en');
function applyLanguage(){
  document.documentElement.lang=language==='zh'?'zh-CN':'en';
  document.querySelectorAll('[data-zh][data-en]').forEach(el=>{
    if(el.dataset.textOnly==='true')el.textContent=el.dataset[language];
    else el.innerHTML=el.dataset[language];
  });
  if(languageButton)languageButton.textContent=language==='zh'?'EN':'中';
  if(menuButton)menuButton.textContent=language==='zh'?'菜单':'Menu';
}
languageButton?.addEventListener('click',()=>{
  language=language==='zh'?'en':'zh';
  try{localStorage.setItem('worklist-language',language);}catch{}
  applyLanguage();
});
applyLanguage();

// Without scripts or observer support, all content stays visible.
if('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion:reduce)').matches){
  try{
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}
    }),{threshold:.1});
    document.documentElement.classList.add('has-reveal');
    document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
  }catch{document.documentElement.classList.remove('has-reveal');}
}

function localizedText(el,zh,en){
  if(!el)return;
  el.dataset.zh=zh;el.dataset.en=en;el.dataset.textOnly='true';
  el.textContent=language==='zh'?zh:en;
}
function verifiedDownloadURL(platform,value){
  if(typeof value!=='string' || !value)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || url.port)return null;
    if(platform==='ios')return url.hostname==='apps.apple.com'?url.href:null;
    const suffix=platform==='windows'?'.exe':'.deb';
    const prefix=platform==='windows'?'/worklist-updates/windows/x64/':'/worklist-updates/kylin/arm64/';
    return url.hostname==='model.hlplan.cn' && url.pathname.startsWith(prefix) && url.pathname.endsWith(suffix)?url.href:null;
  }catch{return null;}
}
function applyDownloads(config){
  if(config?.schema!==1 || !config.platforms || typeof config.platforms!=='object')return;
  for(const platform of ['ios','windows','kylin']){
    const entry=config.platforms[platform];
    if(!entry || typeof entry!=='object')continue;
    const link=document.querySelector(`[data-platform-download="${platform}"]`);
    const version=document.querySelector(`[data-platform-version="${platform}"]`);
    const label=link?.querySelector('[data-download-label]');
    if(!link || !label)continue;
    const versionNumber=typeof entry.version==='string' && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(entry.version)?entry.version:'';
    const architecture=platform==='windows'?'x64':'ARM64';
    if(platform!=='ios' && versionNumber)localizedText(version,`版本 ${versionNumber} · ${architecture}`,`Version ${versionNumber} · ${architecture}`);
    const url=verifiedDownloadURL(platform,entry.url);
    if(!url){
      link.removeAttribute('href');link.removeAttribute('download');link.setAttribute('aria-disabled','true');link.setAttribute('tabindex','-1');
      localizedText(label,'准备中','Coming soon');
      continue;
    }
    link.setAttribute('href',url);link.removeAttribute('aria-disabled');link.removeAttribute('tabindex');
    if(platform!=='ios')link.setAttribute('download',new URL(url).pathname.split('/').pop());
    const labels={ios:['App Store 下载','View in App Store'],windows:['下载 Windows 安装包','Download for Windows'],kylin:['下载麒麟安装包','Download for Kylin']};
    localizedText(label,...labels[platform]);
  }
}
// Static HTML is the no-script and network-failure fallback.
fetch('downloads.json',{cache:'no-store'}).then(response=>{
  if(!response.ok)throw new Error('Download configuration unavailable');
  return response.json();
}).then(applyDownloads).catch(()=>{});
