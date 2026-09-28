const { validateInput, ruleSuggestion } = require('../core/plan-assistant');
const { validateDraft } = require('../core/ai-contract');
const { createCloudTransport } = require('./cloud-transport');
const { apiFunction, planFunction } = require('../config/cloud-resources');
const dates = require('../core/date');
const clone = value => JSON.parse(JSON.stringify(value));
function createPlanAssistant(wxApi, cloudConfig, aiConfig, options = {}) {
  let busy = false, transport, serial = 0;
  const requests = new Map();
  const drafts = new Map(), clock = options.clock || Date.now;
  const configured = () => aiConfig.enabled === true && cloudConfig.enabled === true
    && cloudConfig.functionName === apiFunction && aiConfig.functionName === planFunction
    && typeof cloudConfig.envId === 'string' && cloudConfig.envId.trim() !== '' && !/YOUR_|PLACEHOLDER/i.test(cloudConfig.envId);
  return {
    status: () => ({ configured: configured(), busy }),
    rules: ruleSuggestion,
    async generate(input, consent) {
      const normalized = validateInput(input);
      if (!configured()) throw Error('AI服务尚未配置，可以先用本机规则建议');
      if (consent !== true) throw Error('请先同意将本次安排发送给AI服务');
      if (busy) throw Error('上次请求尚未结束，请勿重复生成；可先用本机规则建议');
      const session=options.session;
      const context=()=>{
        const s=session && session.status();
        if(!s||!s.ready||!s.accountId||!s.epoch)throw Error('云端记录尚未读取，请稍后再申请AI建议');
        if(s.deletionPending||s.conflict||s.pending||s.networkOffline||s.phase==='offline')throw Error('请先完成数据同步，再申请AI建议');
        return {key:s.accountId+':'+s.epoch,epoch:s.epoch};
      };
      const before=context(),requestKey=before.key+':'+JSON.stringify(normalized);
      busy = true;
      let timer;
      try {
        if (!transport) transport = (options.transportFactory || createCloudTransport)(wxApi, {...cloudConfig,functionName:planFunction});
        const day=dates.today(clock());
        let intent=requests.get(requestKey);
        if(!intent || intent.operationDate!==day){
          intent={operationId:'plan-'+clock().toString(36)+'-'+(++serial)+'-'+Math.random().toString(36).slice(2,10),operationDate:day};
          for(const key of requests.keys())if(!key.startsWith(before.key+':'))requests.delete(key);
          if(requests.size>=8)requests.delete(requests.keys().next().value);requests.set(requestKey,intent);
        }
        const operationId=intent.operationId;
        const request=Promise.resolve(transport({action:'suggest',operationId,operationDate:intent.operationDate,epoch:before.epoch,consent:true,input:normalized}));
        // Do not permit another billable request while the timed-out request is still in flight.
        const tracked = request.then(x => { busy = false; return x; }, err => { busy = false; throw err; });
        const response = await Promise.race([tracked, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('AI响应超时，未自动重试；可使用本机规则建议')), aiConfig.timeoutMs || 12000);
        })]);
        const result = response;
        if(context().key!==before.key)throw Error('账户数据已变化，已忽略旧生成结果');
        if (!result || result.ok !== true) throw Error(result && result.code === 'RATE_LIMITED' ? '本次AI额度已用完，可使用本机规则建议' : 'AI暂时不可用，未生成计划；可使用本机规则建议');
        if (result.source !== 'ai' || result.moderated !== true || result.safetyMode !== 'allowlist-v1' || result.operationId !== operationId) throw Error('AI结果未通过来源或安全校验，请使用本机规则建议');
        return { source: 'ai', input: normalized, draft: validateDraft(result.draft, normalized) };
      } catch (err) {
        // A synchronous init/call error has no outstanding Promise to release the lock.
        if (!timer) busy = false;
        throw err;
      } finally { clearTimeout(timer); }
    },
    handoff(suggestion, context) {
      if (!suggestion || !['rule', 'ai'].includes(suggestion.source) || typeof context !== 'string') throw Error('计划预览已失效，请重新生成');
      const input = validateInput(suggestion.input), draft = validateDraft(suggestion.draft, input);
      const token = 'draft-' + clock().toString(36) + '-' + (++serial);
      // Bounded, session-only handoff. No habits, notes or identities in URLs or persistent storage.
      for (const [key, item] of drafts) if (item.expires <= clock()) drafts.delete(key);
      if (drafts.size >= 8) drafts.delete(drafts.keys().next().value);
      drafts.set(token, { source: suggestion.source, draft: clone(draft), context, expires: clock() + 10 * 60000 });
      return token;
    },
    consume(token, context) {
      const item = drafts.get(token); drafts.delete(token);
      if (!item || item.expires <= clock() || item.context !== context) throw Error('计划草稿已过期或数据状态已变化，请返回重新预览');
      return { source: item.source, draft: clone(item.draft) };
    }
  };
}
module.exports = { createPlanAssistant };
