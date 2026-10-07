'use strict';
const cloud=require('wx-server-sdk');
const {businessEvent}=require('./lib/identity');
const {budgetConfiguration,createAiRepository,createAiApi}=require('./lib/ai-plan');
const {createProvider}=require('./lib/ai-provider');
const {configuration,createLimitRepository,createLimiter}=require('./lib/limits');
const inputCore=require('./shared/plan-assistant'),catalog=require('./shared/ai-catalog'),dates=require('./shared/date');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
let limiter;
exports.main=async event=>{
  const env=process.env;
  if(env.HABIT_AI_ENABLED==='false'||['HABIT_AI_STORAGE_READY','HABIT_AI_BUDGET_VERIFIED','HABIT_AI_CATALOG_VERIFIED','HABIT_IDENTITY_VERIFIED',
    'HABIT_MINIPROGRAM_ONLY','HABIT_LIMITS_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'].some(k=>env[k]!=='true')||!env.HABIT_APP_ID)return {ok:false,code:'NOT_ENABLED',message:'AI服务尚未开放，可使用本机规则建议'};
  try{
    if(env.HABIT_AI_PROVIDER!=='deepseek')throw Error('AI_PROVIDER_NOT_CONFIGURED');
    const budget=budgetConfiguration(env),provider=createProvider({key:env.HABIT_AI_API_KEY,model:env.HABIT_AI_MODEL},catalog);
    if(!limiter)limiter=createLimiter({repository:createLimitRepository(cloud.database()),scope:'ai',limits:configuration(env,'HABIT_AI_LIMIT')});
    return await createAiApi({repository:createAiRepository(cloud.database()),inputCore,catalog,dates,budget,provider,limiter,
      allowedAppId:env.HABIT_APP_ID,allowedSources:['wx_client','wx_devtools']})(businessEvent(event),cloud.getWXContext());
  }catch(_){return {ok:false,code:'AI_UNAVAILABLE',message:'AI服务暂不可用，可使用本机规则建议'};}
};
