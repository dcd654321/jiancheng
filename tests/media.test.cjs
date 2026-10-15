const test=require('node:test'),assert=require('node:assert/strict');
const {supervisionFixture}=require('./helpers/supervision-fixture.cjs');
test('uploaded metadata verified pending photo can atomically satisfy required completion',async()=>{
  const f=await supervisionFixture();await f.agreement({required:true});
  assert.equal((await f.mutate({type:'complete',id:'read',date:'2026-10-13'})).code,'PHOTO_REQUIRED');
  const photo=await f.photo(),id=photo.media.mediaId;assert.equal(photo.confirmed.media.status,'pending');
  f.failWrite=true;assert.equal((await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[id]})).ok,false);f.failWrite=false;
  assert.equal((await f.pull()).state.records['read@2026-10-13'],undefined);assert.equal(f.tables.media.get(id).bound,false);
  assert.equal((await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[id]})).ok,true);assert.equal(f.tables.media.get(id).bound,true);
});
test('private sealed bytes do not change when upload draft is overwritten after confirmation',async()=>{
  const f=await supervisionFixture(),photo=await f.photo(),media=f.tables.media.get(photo.media.mediaId),sealed=Buffer.from(f.files.get(media.fileId));
  assert.match(media.fileId,/\/records\//);f.files.set(media.draftFileId,Buffer.from('overwritten draft'));
  const repeat=await f.mediaRequest('confirmMedia',{operationId:media.confirmOperationId,mediaId:media._id,fileId:media.draftFileId});
  assert.equal(repeat.replayed,true);assert.deepEqual(f.files.get(media.fileId),sealed);
});
test('another account, wrong date or unconfirmed photo cannot be bound',async()=>{
  const f=await supervisionFixture(),photo=await f.photo(),id=photo.media.mediaId;
  f.tables.media.get(id).owner=f.owner(f.b);
  assert.equal((await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[id]})).code,'MEDIA_UNAVAILABLE');
  f.tables.media.get(id).owner=f.owner(f.a);f.tables.media.get(id).date='2026-10-12';
  assert.equal((await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[id]})).code,'MEDIA_UNAVAILABLE');
});
test('only signed pass can expose a supervisor photo; reject preserves completed action',async()=>{
  const f=await supervisionFixture(),relation=(await f.agreement({required:true})).supervision.supervisionId,photo=await f.photo(),id=photo.media.mediaId;
  await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[id]});
  const get=()=>f.mediaRequest('getRecordMedia',{supervisionId:relation,date:'2026-10-13'},f.b);
  assert.equal((await get()).recordMedia.items.length,0);
  assert.equal((await f.callback({payload:{traceId:'trace-'+id,status:'pass'}})).statusCode,401);
  const pass=await f.callback({signed:true,payload:{traceId:'trace-'+id,status:'pass'}});assert.equal(pass.statusCode,200);
  const displayed=await get();assert.equal(displayed.recordMedia.items.length,1);assert.match(displayed.recordMedia.items[0].url,/expires=300/);
  const second=await f.callback({signed:true,payload:{traceId:'trace-'+id,status:'risky'}});assert.equal(second.statusCode,401,'a later inconsistent callback cannot mutate terminal proof');
  assert.equal((await f.pull()).state.records['read@2026-10-13'].status,'standard');
});
test('later risky check keeps completion but cannot satisfy a fresh completion after undo',async()=>{
  const f=await supervisionFixture(),relation=(await f.agreement({required:true})).supervision.supervisionId,photo=await f.photo(),id=photo.media.mediaId;
  await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[id]});await f.callback({signed:true,payload:{traceId:'trace-'+id,status:'risky'}});
  assert.equal((await f.mediaRequest('getRecordMedia',{supervisionId:relation,date:'2026-10-13'},f.b)).recordMedia.items.length,0);
  assert.equal((await f.pull()).state.records['read@2026-10-13'].status,'standard');
  await f.mutate({type:'undo',id:'read',date:'2026-10-13'});
  assert.equal((await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[id]})).code,'MEDIA_CHECK_REJECTED');
});
test('last required removal confirms atomic undo and supports same operation receipt replay',async()=>{
  const f=await supervisionFixture();await f.agreement({required:true});const photo=await f.photo(),id=photo.media.mediaId;
  await f.mutate({type:'completeMinimum',id:'read',date:'2026-10-13',mediaIds:[id]});let snapshot=await f.pull();
  const fields={operationId:'remove-last',habitId:'read',date:'2026-10-13',expectedRevision:snapshot.revision,mediaIds:[]};
  assert.equal((await f.mediaRequest('updateRecordMedia',fields)).code,'CONFIRMATION_REQUIRED');
  const removed=await f.mediaRequest('updateRecordMedia',{...fields,confirmation:'REMOVE_LAST_PHOTO_AND_UNDO'});
  assert.equal(removed.snapshot.state.records['read@2026-10-13'].status,'pending');assert.equal(removed.snapshot.revision,snapshot.revision+1);assert.equal(f.tables.media.get(id).bound,false);
  assert.equal(removed.recordMedia.recordStatus,'pending');
  assert.equal((await f.mediaRequest('updateRecordMedia',{...fields,confirmation:'REMOVE_LAST_PHOTO_AND_UNDO'})).replayed,true);
});

test('known freeze failure before upload can retry; an unknown completed upload recovers without overwriting',async()=>{
  const f=await supervisionFixture(),prepared=await f.mediaRequest('prepareMedia',{habitId:'read',date:'2026-10-13',mimeType:'image/png'});
  const fields={operationId:'freeze-op',mediaId:prepared.media.mediaId,fileId:f.provider.fileIdFor(prepared.media.cloudPath)},freeze=f.provider.freeze.bind(f.provider);
  let attempts=0;f.provider.freeze=async(...args)=>{attempts++;if(attempts===1){const error=Error('IMAGE_DOWNLOAD_TIMEOUT');error.freezeStage='before-write';throw error;}return freeze(...args);};
  assert.equal((await f.mediaRequest('confirmMedia',fields)).code,'MEDIA_UPLOAD_RETRY');assert.equal(f.tables.media.get(fields.mediaId).confirmState,undefined);
  f.files.set(fields.fileId,require('./helpers/supervision-fixture.cjs').image);
  assert.equal((await f.mediaRequest('confirmMedia',fields)).ok,true);assert.equal(attempts,2);
  const g=await supervisionFixture(),another=await g.mediaRequest('prepareMedia',{habitId:'read',date:'2026-10-13',mimeType:'image/png'}),baseFreeze=g.provider.freeze.bind(g.provider);
  const unknown={operationId:'unknown-freeze',mediaId:another.media.mediaId,fileId:g.provider.fileIdFor(another.media.cloudPath)};g.files.set(unknown.fileId,require('./helpers/supervision-fixture.cjs').image);
  let uploads=0;g.provider.freeze=async(...args)=>{uploads++;await baseFreeze(...args);throw Error('UPLOAD_RECEIPT_LOST');};
  assert.equal((await g.mediaRequest('confirmMedia',unknown)).code,'MEDIA_CONFIRM_PENDING');const sealedId=g.tables.media.get(unknown.mediaId).fileId,sealed=Buffer.from(g.files.get(sealedId));
  g.files.set(unknown.fileId,Buffer.from('altered draft'));assert.equal((await g.mediaRequest('confirmMedia',unknown)).ok,true);assert.equal(uploads,1);assert.deepEqual(g.files.get(sealedId),sealed);
});
test('expired relationship and subject habit deletion prevent signing existing media',async()=>{
  const f=await supervisionFixture(),relation=(await f.agreement()).supervision.supervisionId,photo=await f.photo();
  await f.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[photo.media.mediaId]});
  f.now=new Date('2026-10-20T04:00:00Z');assert.equal((await f.mediaRequest('getRecordMedia',{supervisionId:relation,date:'2026-10-13'},f.b)).code,'MEDIA_UNAVAILABLE');
});
test('24 hour orphan cleanup leaves freshly uploaded and bound files intact',async()=>{
  const f=await supervisionFixture(),orphan=await f.photo();await f.worker()();assert.equal(f.tables.media.has(orphan.media.mediaId),true);
  f.now=new Date(f.now.getTime()+24*3600000);await f.worker()();assert.equal(f.tables.media.has(orphan.media.mediaId),false);
  const g=await supervisionFixture(),bound=await g.photo();await g.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[bound.media.mediaId]});
  g.now=new Date(g.now.getTime()+25*3600000);await g.worker()();assert.equal(g.tables.media.has(bound.media.mediaId),true);
});
test('cleanup rechecks binding in its mark transaction after stale orphan query',async()=>{
  const f=await supervisionFixture(),photo=await f.photo(),id=photo.media.mediaId;
  f.now=new Date(f.now.getTime()+86400000);let raced=false;
  const query=f.repository.orphanMedia;f.repository.orphanMedia=async(...args)=>{const rows=await query(...args);if(!raced){raced=true;f.tables.media.get(id).bound=true;f.tables.media.get(id).orphanedAt=null;}return rows;};
  await f.worker()();assert.equal(f.tables.media.has(id),true);assert.equal(f.deleted.length,0);
});
test('bound validation rotates batches and failed async checks time out independently of binding',async()=>{
  const f=await supervisionFixture(),first=await f.photo();f.now=new Date(f.now.getTime()+31*60000);await f.worker()();assert.equal(f.tables.media.get(first.media.mediaId).status,'failed');
  // Twenty valid candidates no longer permanently hide later invalid candidates.
  const g=await supervisionFixture(),photo=await g.photo(),source=g.tables.media.get(photo.media.mediaId);await g.mutate({type:'complete',id:'read',date:'2026-10-13',mediaIds:[source._id]});
  for(let i=0;i<20;i++){const id=(i+1).toString(16).padStart(64,'0');g.tables.media.set(id,{...source,_id:id,bound:true,validatedAt:'2026-10-12T00:00:00Z'});}
  g.now=new Date('2026-10-13T05:00:00Z');await g.worker()();assert.equal(g.tables.media.get(source._id).validatedAt,'2026-10-13T04:00:00.000Z');
  g.now=new Date('2026-10-13T05:01:00Z');await g.worker()();assert.equal(g.tables.media.get(source._id).validatedAt,g.now.toISOString());
});
