const { fixture, domain, dates, copy } = require('./cloud-fixture.cjs');
const { createFeaturesApi, createPublicShareApi } = require('../../server/features');
function featuresFixture() {
  const f = fixture(), prefs = new Map(), shares = new Map();
  let tail = Promise.resolve(), serial = 0;
  const repository = {
    transact(owner, work) {
      const next = tail.then(async () => {
        const p = new Map([...prefs].map(([k,v])=>[k,copy(v)])), s = new Map([...shares].map(([k,v])=>[k,copy(v)]));
        const result = await work({ account: async()=>copy(f.db.get(owner)), preferences: async()=>copy(p.get(owner)),
          share: async id=>copy(s.get(id)), putPreferences: async value=>p.set(owner,copy(value)),
          putShare: async value=>s.set(value._id,copy(value)), removeShare: async id=>s.delete(id) });
        if(f.failFeaturesWrite) throw Error('fake sdk secret must not leak');
        prefs.clear(); p.forEach((v,k)=>prefs.set(k,v)); shares.clear(); s.forEach((v,k)=>shares.set(k,v));
        return copy(result);
      });
      tail=next.catch(()=>{}); return next;
    },
    async account(owner) { if(f.failRead) throw Error('offline'); return copy(f.db.get(owner)); },
    async share(id) { if(f.failRead) throw Error('offline'); return copy(shares.get(id)); }
  };
  const clock=()=>new Date(f.date+'T04:00:00Z');
  const handle=createFeaturesApi({repository,domain,dates,clock,allowedAppId:f.identity.APPID,allowedSources:['wx_client','wx_devtools']});
  return Object.assign(f,{ prefs,shares,repository,features:handle,
    publicShare:createPublicShareApi({repository,domain,dates,clock}),
    async requestShare(kind='invite',extra={}) {
      const a=await f.pull();
      return {action:'createShare',epoch:a.epoch,requestDate:f.date,requestId:(++serial).toString(16).padStart(64,'0'),sourceRevision:a.revision,kind,...extra};
    }
  });
}
module.exports={featuresFixture};
