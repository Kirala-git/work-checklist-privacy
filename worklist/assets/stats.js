(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root && root.document){
    const controller=api.createController({window:root,document:root.document});
    if(controller)controller.init();
  }
})(typeof window==='object'?window:null,function(){
  'use strict';
  const SITE='worklist';
  const PLATFORMS=['ios','windows','kylin'];
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const VISITOR_KEY='worklist-site-visitor-v1';
  const SESSION_KEY='worklist-site-session-v1';
  const VISITOR_TTL=90*24*60*60*1000;
  const SESSION_TTL=30*60*1000;
  const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const isCount=value=>Number.isSafeInteger(value) && value>=0;

  function validateEndpoint(value){
    if(typeof value!=='string')throw new Error('Invalid statistics endpoint');
    if(value.trim()==='')return '';
    const url=new URL(value);
    if(url.protocol!=='https:' || url.hostname!=='hlplan.cn' || url.pathname!=='/' || url.username || url.password || url.search || url.hash || url.port)throw new Error('Approved HTTPS statistics endpoint required');
    return url.origin;
  }
  function validDownloadURL(platform,value){
    if(typeof value!=='string' || !value)return false;
    try{
      const url=new URL(value);
      if(url.protocol!=='https:' || url.username || url.password || url.port)return false;
      if(platform==='ios')return url.hostname==='apps.apple.com' && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id6795366716\/?$/.test(url.pathname);
      if(url.hostname!=='model.hlplan.cn')return false;
      if(platform==='windows')return url.pathname.startsWith('/worklist-updates/windows/x64/') && url.pathname.endsWith('.exe');
      if(platform==='kylin')return url.pathname.startsWith('/worklist-updates/kylin/arm64/') && url.pathname.endsWith('.deb');
      return false;
    }catch{return false;}
  }
  function validUTC(value){
    return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19)===value.slice(0,19);
  }
  function validateSummary(value){
    if(!isObject(value) || value.site!==SITE || value.measurement!=='page_views_and_download_clicks' || value.timezone!=='Asia/Shanghai')throw new Error('Unexpected statistics response');
    if(typeof value.day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !validUTC(`${value.day}T00:00:00Z`) || !validUTC(value.startedAt) || !validUTC(value.updatedAt) || Date.parse(value.startedAt)>Date.parse(value.updatedAt))throw new Error('Invalid statistics date');
    if((value.visitorRetentionDays!==undefined && value.visitorRetentionDays!==90) || (value.eventRetentionDays!==undefined && value.eventRetentionDays!==30))throw new Error('Unexpected statistics retention');
    const result={site:SITE,timezone:value.timezone,day:value.day,startedAt:value.startedAt,updatedAt:value.updatedAt,measurement:value.measurement};
    for(const period of ['total','today']){
      const metrics=value[period];
      if(!isObject(metrics) || !isObject(metrics.downloadClicks) || !isCount(metrics.pv) || !isCount(metrics.visitors) || metrics.visitors>metrics.pv)throw new Error('Invalid statistics count');
      const clicks={};
      for(const platform of PLATFORMS){
        if(!isCount(metrics.downloadClicks[platform]))throw new Error('Invalid download count');
        clicks[platform]=metrics.downloadClicks[platform];
      }
      result[period]=Object.freeze({pv:metrics.pv,visitors:metrics.visitors,downloadClicks:Object.freeze(clicks)});
    }
    if(result.today.pv>result.total.pv || result.today.visitors>result.total.visitors || PLATFORMS.some(platform=>result.today.downloadClicks[platform]>result.total.downloadClicks[platform]))throw new Error('Inconsistent statistics count');
    return Object.freeze(result);
  }
  function prefersPrivacy(navigator,window){
    const enabled=value=>value==='1' || value===1 || value==='yes';
    return navigator.globalPrivacyControl===true || enabled(navigator.doNotTrack) || enabled(navigator.msDoNotTrack) || enabled(window.doNotTrack);
  }
  function randomUUID(crypto){
    try{
      if(typeof crypto?.randomUUID==='function'){
        const id=crypto.randomUUID();
        return UUID.test(id)?id:null;
      }
      if(typeof crypto?.getRandomValues!=='function')return null;
      const bytes=crypto.getRandomValues(new Uint8Array(16));
      bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
      const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }catch{return null;}
  }
  function anonymousIdentity({storage,key,ttl,crypto,now,visitorId}){
    let record;
    try{record=JSON.parse(storage?.getItem(key)||'null');}catch{}
    if(!isObject(record) || !UUID.test(record.id||'') || !Number.isSafeInteger(record.expiresAt) || record.expiresAt<=now || record.expiresAt>now+ttl || (visitorId && record.visitorId!==visitorId))record=null;
    if(!record){
      const id=randomUUID(crypto);
      if(!id)return null;
      record={id,expiresAt:now+ttl};
      if(visitorId)record.visitorId=visitorId;
      try{storage?.setItem(key,JSON.stringify(record));}catch{}
    }
    return record;
  }

  function createController(options){
    const window=options.window;
    const document=options.document;
    const root=document.querySelector('[data-site-stats]');
    if(!root)return null;
    const navigator=options.navigator||window.navigator||{};
    const fetch=options.fetch||window.fetch?.bind(window);
    const crypto=options.crypto||window.crypto;
    const now=options.now||Date.now;
    const setTimer=options.setTimeout||window.setTimeout.bind(window);
    const clearTimer=options.clearTimeout||window.clearTimeout.bind(window);
    const Abort=options.AbortController||window.AbortController;
    const status=root.querySelector('[data-stats-status]');
    const meta=root.querySelector('[data-stats-meta]');
    const refreshButton=root.querySelector('[data-stats-refresh]');
    const cells=Array.from(root.querySelectorAll('[data-stats-value]'));
    let endpoint='';
    let phase='unconfigured';
    let summary=null;
    let visitor=null;
    let session=null;
    let initialized=false;
    let visitAttempted=false;
    let destroyed=false;
    let configurationPromise=null;
    let refreshPromise=null;
    let refreshTimer=null;
    const activeRequests=new Set();

    function language(){return document.documentElement.lang.toLowerCase().startsWith('zh')?'zh':'en';}
    function render(){
      if(destroyed)return;
      const zh=language()==='zh';
      const privacy=prefersPrivacy(navigator,window);
      const messages={
        unconfigured:zh?'统计接入中':'Statistics are being connected',
        loading:zh?'正在读取统计…':'Loading statistics…',
        ready:zh?'实际记录 · 今日按北京时间统计':'Recorded activity · Today uses Beijing time',
        unavailable:zh?(summary?'暂不可用 · 显示上次读取的数据':'统计暂不可用'):(summary?'Temporarily unavailable · Showing the last retrieved values':'Statistics temporarily unavailable')
      };
      root.setAttribute('data-state',phase);
      status.textContent=messages[phase]+(privacy?(zh?' · DNT/GPC 已开启，本次不上报':' · DNT/GPC enabled; this visit is not reported'):'');
      refreshButton.disabled=phase==='unconfigured' || phase==='loading';
      const format=new Intl.NumberFormat(zh?'zh-CN':'en-US');
      for(const cell of cells){
        const path=cell.getAttribute('data-stats-value').split('.');
        let value=summary;
        for(const key of path)value=value?.[key];
        cell.textContent=isCount(value)?format.format(value):'—';
      }
      if(summary){
        const formatter=new Intl.DateTimeFormat(zh?'zh-CN':'en-US',{timeZone:summary.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
        const started=formatter.format(new Date(summary.startedAt));
        const updated=formatter.format(new Date(summary.updatedAt));
        meta.textContent=zh?`统计自 ${started} 接入起，此前数据未补算。今日：${summary.day}（北京时间）；更新：${updated}。`:`Measured since ${started}; earlier activity was not added. Today: ${summary.day} (Beijing time). Updated: ${updated}.`;
      }else meta.textContent=zh?'接入后仅展示实际记录，不补算此前数据。':'Only recorded activity will be shown once connected; earlier activity will not be added.';
    }
    async function requestJSON(url,init,maxLength){
      if(typeof fetch!=='function')throw new Error('Statistics transport unavailable');
      const controller=Abort?new Abort():null;
      if(controller)activeRequests.add(controller);
      const timer=controller?setTimer(()=>controller.abort(),8000):null;
      try{
        const response=await fetch(url,{credentials:'omit',cache:'no-store',mode:'cors',redirect:'error',...init,...(controller?{signal:controller.signal}:{})});
        if(!response.ok)throw new Error('Statistics request failed');
        const text=await response.text();
        if(text.length>maxLength)throw new Error('Statistics response too large');
        return JSON.parse(text);
      }finally{
        if(timer!==null)clearTimer(timer);
        if(controller)activeRequests.delete(controller);
      }
    }
    function refresh(){
      if(destroyed)return Promise.resolve(null);
      if(!endpoint)return loadConfiguration();
      if(refreshPromise)return refreshPromise;
      phase='loading';render();
      refreshPromise=requestJSON(`${endpoint}/api/site-stats/summary?site=${SITE}`,{method:'GET'},16384).then(value=>{
        summary=validateSummary(value);phase='ready';render();return summary;
      }).catch(()=>{phase='unavailable';render();return null;}).finally(()=>{refreshPromise=null;});
      return refreshPromise;
    }
    function loadConfiguration(){
      if(destroyed)return Promise.resolve(null);
      if(configurationPromise)return configurationPromise;
      phase='loading';render();
      configurationPromise=requestJSON('stats-config.json',{method:'GET'},4096).then(config=>{
        if(destroyed)return null;
        if(!isObject(config))throw new Error('Invalid statistics configuration');
        endpoint=validateEndpoint(config.endpoint);
        if(!endpoint){phase='unconfigured';render();return null;}
        if(!visitAttempted){visitAttempted=true;report('visit');}
        return refresh();
      }).catch(()=>{phase='unavailable';render();return null;}).finally(()=>{configurationPromise=null;});
      return configurationPromise;
    }
    function identities(){
      if(prefersPrivacy(navigator,window))return false;
      const time=now();
      if(visitor && session && visitor.expiresAt>time && session.expiresAt>time)return true;
      let localStorage,sessionStorage;
      try{localStorage=options.storage||window.localStorage;}catch{}
      try{sessionStorage=options.sessionStorage||window.sessionStorage;}catch{}
      if(!visitor || visitor.expiresAt<=time)visitor=anonymousIdentity({storage:localStorage,key:VISITOR_KEY,ttl:VISITOR_TTL,crypto,now:time});
      if(visitor)session=anonymousIdentity({storage:sessionStorage,key:SESSION_KEY,ttl:SESSION_TTL,crypto,now:time,visitorId:visitor.id});
      return Boolean(visitor && session);
    }
    async function report(action,platform){
      if(destroyed || !endpoint || prefersPrivacy(navigator,window) || !identities())return;
      const eventId=randomUUID(crypto);
      if(!eventId)return;
      const event={site:SITE,action,eventId,visitorId:visitor.id,sessionId:session.id};
      if(action==='download_click')event.platform=platform;
      try{
        const result=await requestJSON(`${endpoint}/api/site-stats/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),keepalive:true},2048);
        if(result?.ok===true && !destroyed){
          if(refreshTimer!==null)clearTimer(refreshTimer);
          refreshTimer=setTimer(()=>{refreshTimer=null;refresh();},700);
        }
      }catch{/* Reporting must never interrupt a direct download. */}
    }
    function onDownload(event){
      if(event.isTrusted!==true || (event.type==='click' && event.button!==0) || (event.type==='auxclick' && event.button!==1))return;
      const link=event.target?.closest?.('a[data-platform-download]');
      if(!link || link.getAttribute('aria-disabled')==='true')return;
      const platform=link.getAttribute('data-platform-download');
      if(!PLATFORMS.includes(platform))return;
      if(!validDownloadURL(platform,link.getAttribute('href')))return;
      report('download_click',platform);
    }
    const onLanguage=()=>render();
    const onRefresh=()=>refresh();
    document.addEventListener('click',onDownload,{capture:true});
    document.addEventListener('auxclick',onDownload,{capture:true});
    document.addEventListener('worklist:languagechange',onLanguage);
    refreshButton.addEventListener('click',onRefresh);
    render();
    return Object.freeze({
      async init(){
        if(initialized || destroyed)return;
        initialized=true;
        return loadConfiguration();
      },
      refresh,
      getState:()=>({phase,summary,endpoint}),
      destroy(){
        destroyed=true;
        if(refreshTimer!==null)clearTimer(refreshTimer);
        for(const request of activeRequests)request.abort();
        document.removeEventListener('click',onDownload,{capture:true});
        document.removeEventListener('auxclick',onDownload,{capture:true});
        document.removeEventListener('worklist:languagechange',onLanguage);
        refreshButton.removeEventListener('click',onRefresh);
      }
    });
  }
  return Object.freeze({validateEndpoint,validDownloadURL,validateSummary,prefersPrivacy,anonymousIdentity,createController});
});
