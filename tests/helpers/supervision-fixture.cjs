const crypto=require('node:crypto');
const {domain,dates,plan,copy}=require('./cloud-fixture.cjs');
const {createApi}=require('../../server/handler');
const {createSupervisionApi}=require('../../server/supervision');
const {createMediaApi,createRecordMutationGuard}=require('../../server/media');
const {createMediaWorker,createMediaCallback}=require('../../server/media-worker');
const {hash,bindingId}=require('../../server/supervision-repository');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==','base64');
async function supervisionFixture() {
  const appId='wx58e61dffcbfa4249',a={APPID:appId,OPENID:'subject_a',SOURCE:'wx_client'},b={...a,OPENID:'supervisor_b'},c={...a,OPENID:'stranger_c'};
  const owner=identity=>hash(identity.APPID+':'+identity.OPENID),tables={accounts:new Map(),invites:new Map(),relations:new Map(),indexes:new Map(),media:new Map(),bindings:new Map(),traces:new Map()};
  let tail=Promise.resolve(),serial=0;const f={a,b,c,appId,owner,tables,now:new Date('2026-10-13T04:00:00Z'),failWrite:false,files:new Map(),deleted:[],checks:[]};
  const clock=()=>new Date(f.now);
  const repository={
    transact(currentOwner,work) {
      const result=tail.then(async()=>{
        const draft=Object.fromEntries(Object.entries(tables).map(([key,values])=>[key,new Map([...values].map(([id,value])=>[id,copy(value)]))]));
        const get=(table,id)=>Promise.resolve(copy(draft[table].get(id)||null)),put=(table,value)=>draft[table].set(value._id,copy(value));
        const tx={owner:currentOwner,account:(other=currentOwner)=>get('accounts',other),putAccount:(value,other=currentOwner)=>draft.accounts.set(other,copy(value)),
          invite:id=>get('invites',id),putInvite:value=>put('invites',value),supervision:id=>get('relations',id),putSupervision:value=>put('relations',value),
          supervisionIndex:(other=currentOwner)=>get('indexes',other),putSupervisionIndex:value=>put('indexes',value),
          media:id=>get('media',id),putMedia:value=>put('media',value),removeMedia:id=>draft.media.delete(id),
          binding:(other,epoch,habit,date)=>get('bindings',bindingId(other,epoch,habit,date)),putBinding:value=>put('bindings',value),removeBinding:id=>draft.bindings.delete(id),
          trace:id=>get('traces',hash(id)),putTrace:value=>draft.traces.set(hash(value.traceId),copy(value)),removeTrace:id=>draft.traces.delete(hash(id))};
        if(f.beforeWork)await f.beforeWork(tx);
        const response=await work(tx);if(f.failWrite)throw Error('LOCAL_FIXTURE_COMMIT_FAILED');
        for(const [table,values]of Object.entries(draft)){tables[table].clear();values.forEach((value,id)=>tables[table].set(id,value));}return copy(response);
      });tail=result.catch(()=>{});return result;
    },
    pendingMedia:async(limit)=>[...tables.media.values()].filter(m=>m.status==='pending'&&m.checkState==='queued').slice(0,limit).map(copy),
    stalledChecks:async(now,limit)=>[...tables.media.values()].filter(m=>m.status==='pending'&&Date.parse(m.checkStartedAt)<=now.getTime()-1800000).slice(0,limit).map(copy),
    mediaCandidates:async(now,limit)=>[...tables.media.values()].filter(m=>m.bound).sort((x,y)=>x.validatedAt.localeCompare(y.validatedAt)).slice(0,limit).map(copy),
    invalidationMedia:async limit=>[...tables.media.values()].filter(m=>m.deleteRequested).slice(0,limit).map(copy),
    orphanMedia:async(now,limit)=>[...tables.media.values()].filter(m=>Date.parse(m.orphanedAt)<=now.getTime()-86400000).slice(0,limit).map(copy),
    preparedMedia:async(now,limit)=>[...tables.media.values()].filter(m=>m.status==='prepared'&&Date.parse(m.createdAt)<=now.getTime()-86400000).slice(0,limit).map(copy)
  };
  const prefix='cloud://local.test/';
  const provider={fileIdFor:path=>prefix+path,owns:(id,path)=>id===prefix+path,inspect:async id=>{if(!f.files.has(id))throw Error('NOT_UPLOADED');const bytes=f.files.get(id);return{bytes:bytes.length,mimeType:'image/png',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),fileContent:bytes};},
    async freeze(media,id){const inspected=await this.inspect(id),fileId=prefix+media.sealedPath;f.files.set(fileId,Buffer.from(inspected.fileContent));return {...inspected,fileId};},
    temporaryUrl:async(id,seconds)=>{assertPrivate(id);return'https://storage.test/'+encodeURIComponent(id)+'?expires='+seconds;},
    check:async(media,openid)=>{f.checks.push({mediaId:media._id,openid});if(f.checkFailure)throw Error('CHECK_UNKNOWN');return{traceId:'trace-'+media._id};},
    delete:async ids=>{f.deleted.push(...ids);ids.forEach(id=>f.files.delete(id));},verifyCallback:event=>{if(!event.signed)throw Error('BAD_SIGNATURE');return event.payload;},checkText:async text=>text!=='bad'};
  function assertPrivate(id){if(!id.startsWith(prefix+'jiancheng_daka_media/records/'))throw Error('UNSEALED_URL');}
  const guard=createRecordMutationGuard({domain,dates}),coreRepository={transact:(id,callback)=>repository.transact(id,async tx=>{const result=await callback(await tx.account(),tx);await tx.putAccount(result.account);return result.result;})};
  const api=createApi({repository:coreRepository,domain,dates,allowedAppId:appId,allowedSources:['wx_client'],clock,newEpoch:()=>crypto.randomUUID(),recordMutationGuard:guard});
  const supervision=createSupervisionApi({repository,domain,dates,allowedAppId:appId,allowedSources:['wx_client'],clock,checkText:provider.checkText});
  const media=createMediaApi({repository,provider,domain,dates,allowedAppId:appId,allowedSources:['wx_client'],clock});
  f.repository=repository;f.provider=provider;f.api=api;f.clock=clock;f.guard=guard;f.domain=domain;f.dates=dates;
  f.pull=(identity=a)=>api({action:'pull'},identity);
  f.mutate=async(command,identity=a)=>{const snapshot=await f.pull(identity);return api({action:'mutate',epoch:snapshot.epoch,expectedRevision:snapshot.revision,operationId:'core-'+(++serial),operationDate:dates.today(f.now.getTime()),command},identity);};
  f.request=async(action,fields={},identity=a)=>{const account=tables.accounts.get(owner(identity));return supervision({action,epoch:account.epoch,...(!action.startsWith('get')&&action!=='listSupervisions'?{operationId:'supervision-'+(++serial)}:{}),...fields},identity);};
  f.mediaRequest=async(action,fields={},identity=a)=>{const account=tables.accounts.get(owner(identity));return media({action,epoch:account.epoch,...(action!=='getRecordMedia'?{operationId:'media-'+(++serial)}:{}),...fields},identity);};
  f.agreement=async({required=false}={})=>{const invite=await f.request('createSupervisionInvite',{habitId:'read',photoRequired:required,displayName:'小甲'});const id=invite.invite.inviteId;await f.request('applySupervision',{inviteId:id,displayName:'小乙'},b);return f.request('confirmSupervision',{inviteId:id});};
  f.photo=async(habitId='read')=>{const prepared=await f.mediaRequest('prepareMedia',{habitId,date:dates.today(f.now.getTime()),mimeType:'image/png'});f.files.set(prefix+prepared.media.cloudPath,Buffer.from(image));const confirmed=await f.mediaRequest('confirmMedia',{mediaId:prepared.media.mediaId,fileId:prefix+prepared.media.cloudPath});return {...prepared,confirmed};};
  f.worker=()=>createMediaWorker({repository,provider,clock});f.callback=createMediaCallback({repository,provider,clock});
  await f.pull(a);await f.pull(b);await f.pull(c);await f.mutate({type:'create',id:'read',startDate:dates.today(f.now.getTime()),plan:plan()});return f;
}
module.exports={supervisionFixture,image};
