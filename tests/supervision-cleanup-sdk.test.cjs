const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createSupervisionCleanup}=require('../server/media-worker');
const names=require('../server/supervision-repository');
const {COLLECTION}=require('../server/cloudbase-repository');
const {supervisionFixture}=require('./helpers/supervision-fixture.cjs');
const sdkPath=path.resolve(__dirname,'../cloudfunctions/jiancheng_daka_api/node_modules/wx-server-sdk');

test('installed SDK cleanup removes only purged-epoch supervision, invitations, attachments and traces, preserving the other member records',
  {skip:!fs.existsSync(sdkPath)&&'请安装锁定云函数依赖'},async t=>{
    const http=require('node:http'),https=require('node:https'),originalNetwork=[http.request,https.request,global.fetch];
    http.request=https.request=global.fetch=()=>{throw Error('CLEANUP_SDK_NETWORK_FORBIDDEN');};
    t.after(()=>{[http.request,https.request,global.fetch]=originalNetwork;});
    const f=await supervisionFixture(),relation=await f.agreement(),photo=await f.photo();
    await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[photo.media.mediaId]});
    await f.request('encourageSupervision',{supervisionId:relation.supervision.supervisionId,date:'2026-10-13',kind:'encourage'},f.b);
    const owner=f.owner(f.a),other=f.owner(f.b),epoch=f.tables.accounts.get(owner).epoch;
    const cloud=require(sdkPath);cloud.init({env:'supervision-cleanup-sdk-local-only'});const db=cloud.database(),Db=db._db.constructor,originalRequest=Db.reqClass;
    let saved=new Map(),serial=0,fault=false;const transactions=new Map();
    const collections={accounts:COLLECTION,invites:names.INVITES,relations:names.RELATIONS,indexes:names.INDEXES,media:names.MEDIA,bindings:names.BINDINGS,traces:names.TRACES};
    for(const [table,values]of Object.entries(f.tables))for(const [id,value]of values){saved.set(collections[table]+':'+id,JSON.stringify({_id:id,...(table==='accounts'?{payload:value}:value)}));}
    Db.reqClass=class {async send(action,params={}){
      if(action==='database.startTransaction'){const id='cleanup-tx-'+(++serial);transactions.set(id,new Map(saved));return{transactionId:id};}
      if(action==='database.abortTransaction'){transactions.delete(params.transactionId);return{ok:1};}
      if(action==='database.commitTransaction'){saved=transactions.get(params.transactionId);transactions.delete(params.transactionId);return{ok:1};}
      assert.ok(Object.values(collections).includes(params.collectionName));
      const target=params.transactionId?transactions.get(params.transactionId):saved,query=JSON.parse(params.query),prefix=params.collectionName+':';
      if(action==='database.getDocument'){const rows=[...target].filter(([key,value])=>key.startsWith(prefix)&&Object.entries(query).every(([field,expected])=>JSON.parse(value)[field]===expected));return{data:{list:rows.slice(0,params.limit||100).map(([,value])=>value)}};}
      if(action==='database.modifyDocument'){assert.ok(params.transactionId);target.set(prefix+query._id,JSON.stringify({_id:query._id,...JSON.parse(params.data)}));return{data:{updated:1}};}
      if(action==='database.removeDocument'){assert.ok(params.transactionId);if(fault&&params.collectionName===names.RELATIONS)return{code:'PERMISSION_DENIED',message:'local fault'};const removed=target.delete(prefix+query._id);return{data:{deleted:removed?1:0}};}
      throw Error('UNEXPECTED_SDK_ACTION '+action);
    }};
    t.after(()=>{Db.reqClass=originalRequest;});
    const deleted=[],cleanup=createSupervisionCleanup(db,{delete:async ids=>deleted.push(...ids)},{clock:f.clock});
    await assert.rejects(cleanup(owner,epoch),/LIVE_ACCOUNT_CLEANUP_FORBIDDEN/);assert.ok(saved.has(names.RELATIONS+':'+relation.supervision.supervisionId));
    const current=JSON.parse(saved.get(COLLECTION+':'+owner));current.payload={...current.payload,epoch:'next-owner-epoch',cleanupPending:true};saved.set(COLLECTION+':'+owner,JSON.stringify(current));
    const newMedia={_id:'e'.repeat(64),owner,ownerEpoch:'next-owner-epoch',habitId:'next',date:'2026-10-14',fileId:'new-epoch-file'};
    saved.set(names.MEDIA+':'+newMedia._id,JSON.stringify(newMedia));
    fault=true;await assert.rejects(cleanup(owner,epoch));assert.ok(saved.has(names.RELATIONS+':'+relation.supervision.supervisionId));assert.ok(JSON.parse(saved.get(names.INDEXES+':'+other)).relationIds.includes(relation.supervision.supervisionId));fault=false;
    await cleanup(owner,epoch);assert.equal(saved.has(names.RELATIONS+':'+relation.supervision.supervisionId),false);assert.equal(saved.has(names.INDEXES+':'+owner),false);
    const otherIndex=JSON.parse(saved.get(names.INDEXES+':'+other));assert.deepEqual(otherIndex.relationIds,[]);assert.deepEqual(otherIndex.inviteIds,[]);assert.equal(otherIndex.receipts.length,0);
    for(const collection of [names.INVITES,names.BINDINGS,names.TRACES])assert.equal([...saved.keys()].some(key=>key.startsWith(collection+':')),false);
    assert.equal(saved.has(names.MEDIA+':'+photo.media.mediaId),false);assert.equal(saved.has(names.MEDIA+':'+newMedia._id),true);assert.equal(deleted.includes('new-epoch-file'),false);
    assert.ok(deleted.length>=2);assert.ok(saved.has(COLLECTION+':'+other));assert.equal(JSON.parse(saved.get(COLLECTION+':'+owner)).payload.epoch,'next-owner-epoch');
    await cleanup(owner,epoch);assert.equal(saved.has(names.MEDIA+':'+newMedia._id),true,'cleanup retry preserves the next generation');
  });
