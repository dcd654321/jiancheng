'use strict';
const https=require('node:https');
function postJSON(body,key,{httpsApi=https,timeoutMs=8000}={}) {
  return new Promise((resolve,reject)=>{
    let timer,request,settled=false;
    const done=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(Error('AI_PROVIDER_UNAVAILABLE')):resolve(value);};
    try {
      const bytes=Buffer.from(JSON.stringify(body),'utf8');if(bytes.length>4096)throw Error('AI_REQUEST_TOO_LARGE');
      request=httpsApi.request({hostname:'api.deepseek.com',port:443,path:'/chat/completions',method:'POST',
        headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Length':bytes.length}},response=>{
        if(response.statusCode!==200){response.resume();done(Error('AI_HTTP_ERROR'));return;}
        let size=0;const chunks=[];
        response.on('data',chunk=>{size+=chunk.length;if(size>32768){done(Error('AI_BODY_TOO_LARGE'));request.destroy();}else chunks.push(chunk);});
        response.on('error',()=>done(Error('AI_BODY_ERROR')));
        response.on('aborted',()=>done(Error('AI_BODY_ABORTED')));
        response.on('end',()=>{try{done(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(_){done(Error('AI_JSON_INVALID'));}});
      });
      request.on('error',()=>done(Error('AI_REQUEST_ERROR')));
      timer=setTimeout(()=>{done(Error('AI_TIMEOUT'));request.destroy();},timeoutMs);
      request.end(bytes);
    }catch(_){done(Error('AI_REQUEST_FAILED'));}
  });
}
function createProvider({key,model,post=postJSON},catalog) {
  if(typeof key!=='string'||key.length<16||key.length>512||/\s/.test(key)||typeof model!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(model))throw Error('AI_PROVIDER_CONFIG_REQUIRED');
  return async input=>{
    const options=catalog.ACTIONS[input.direction].map(x=>({key:x.key,action:x.action}));
    const result=await post({model,stream:false,max_tokens:512,thinking:{type:'disabled'},response_format:{type:'json_object'},
      messages:[{role:'system',content:'你是日常小习惯计划助手。只能选择给定动作和说明代码，目标为1到可用分钟的整数。minimum是小于目标的正整数或null。禁止健康、成绩或固定天数养成保证。仅输出JSON四字段，例如 {"actionKey":"read-resume","reasonKey":"start-small","target":5,"minimum":1}。'},
        {role:'user',content:JSON.stringify({direction:input.direction,minutes:input.minutes,actions:options,reasons:Object.keys(catalog.REASONS)})}]},key);
    if(!result||!Array.isArray(result.choices)||result.choices.length!==1||result.choices[0].finish_reason!=='stop'||
      !result.choices[0].message||typeof result.choices[0].message.content!=='string'||Buffer.byteLength(result.choices[0].message.content,'utf8')>1024)throw Error('AI_RESULT_INVALID');
    return JSON.parse(result.choices[0].message.content);
  };
}
module.exports={postJSON,createProvider};
