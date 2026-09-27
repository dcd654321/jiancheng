const {fixture,domain,dates,copy}=require('./cloud-fixture.cjs');
const {createReminderApi,createRecipientCodec}=require('../../server/reminders');
const {createReminderWorker}=require('../../server/reminder-worker');
function reminderFixture() {
  const f=fixture(),reminders=new Map();let tail=Promise.resolve();
  f.time=Date.parse(f.date+'T04:00:00Z');f.sends=[];f.writeFails=false;
  const repository={transact(owner,work){
    const next=tail.then(async()=>{
      const draft=new Map([...reminders].map(([k,v])=>[k,copy(v)]));
      const result=await work({account:async()=>copy(f.db.get(owner)),reminder:async id=>copy(draft.get(id)),put:async doc=>{if(f.writeFails)throw Error('private write failure');draft.set(doc._id,copy(doc));}});
      reminders.clear();draft.forEach((v,k)=>reminders.set(k,v));return copy(result);
    });tail=next.catch(()=>{});return next;
  },async due(now,n){return [...reminders.values()].filter(r=>r.status==='pending'&&Date.parse(r.dueAt)<=now.getTime()).slice(0,n).map(copy);},
  async stale(now,n){return [...reminders.values()].filter(r=>r.status==='claimed'&&Date.parse(r.claimedAt)<=now.getTime()-300000).slice(0,n).map(copy);}};
  const codec=createRecipientCodec('b'.repeat(64)),config={repository,domain,dates,codec,templateId:'real-template-fixture',clock:()=>new Date(f.time)};
  const api=createReminderApi({...config,allowedAppId:f.identity.APPID,allowedSources:['wx_client','wx_devtools']});
  return Object.assign(f,{reminders,repository,codec,reminderApi:(event,identity=f.identity)=>api(event,identity),
    worker:(options={})=>createReminderWorker({...config,send:async message=>{f.sends.push(message);return {errCode:0};},...options}),
    async preview(slot='12:30'){const a=await f.pull();return (await api({action:'previewReminder',epoch:a.epoch,slot},f.identity)).preview;},
    async schedule(preview){const a=await f.pull(),{templateId,...fields}=preview||await f.preview();return api({action:'scheduleReminder',epoch:a.epoch,...fields,subscriptionResult:'accept'},f.identity);}
  });
}
module.exports={reminderFixture};
