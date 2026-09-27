'use strict';
const cloud=require('wx-server-sdk');
const {createReminderRepository,createRecipientCodec}=require('./lib/reminders');
const {authorizeTimer,createReminderWorker,createSender}=require('./lib/reminder-worker');
const {configuration,createLimitRepository,createLimiter}=require('./lib/limits');
const domain=require('./shared/habits'),dates=require('./shared/date');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
let limiter;
exports.main=async event=>{
  const env=process.env;
  if(['HABIT_REMINDERS_ENABLED','HABIT_REMINDER_STORAGE_READY','HABIT_TIMER_VERIFIED','HABIT_TEMPLATE_VERIFIED','HABIT_REMINDER_TTL_VERIFIED',
    'HABIT_LIMITS_VERIFIED','HABIT_IDENTITY_VERIFIED','HABIT_SIDECAR_CLEANUP_ENABLED'].some(k=>env[k]!=='true'))return {ok:false,code:'NOT_ENABLED'};
  try {
    if(!authorizeTimer(event,cloud.getWXContext(),env.HABIT_TIMER_SECRET,env.HABIT_TIMER_NAME))return {ok:false,code:'UNAUTHORIZED'};
    const codec=createRecipientCodec(env.HABIT_REMINDER_KEY),fields=JSON.parse(env.HABIT_REMINDER_FIELDS||'null');
    const send=createSender(cloud,{templateId:env.HABIT_REMINDER_TEMPLATE,fields,state:env.HABIT_MESSAGE_STATE});
    if(!limiter)limiter=createLimiter({repository:createLimitRepository(cloud.database()),scope:'reminder-send',limits:configuration(env,'HABIT_SEND_LIMIT',false)});
    return await createReminderWorker({repository:createReminderRepository(cloud.database()),domain,dates,codec,send,limiter,templateId:env.HABIT_REMINDER_TEMPLATE})();
  } catch(_){return {ok:false,code:'SERVICE_UNAVAILABLE'};}
};
