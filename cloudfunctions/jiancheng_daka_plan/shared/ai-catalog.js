const { validateDraft } = require('./ai-contract');
const ACTIONS = {
  read: [
    { key:'read-resume',title:'读一会儿',action:'打开手边的书，从上次停下的位置继续；到时间就可以停。' },
    { key:'read-focus',title:'专心读一小段',action:'选一小段想读的内容，暂时放下其他屏幕，读完圈出一句喜欢的话。' },
    { key:'read-recall',title:'读后想起一点',action:'读一小段内容，结束前用自己的话想一想最有印象的一点。' }
  ],
  study: [
    { key:'study-review',title:'复习一小段',action:'打开一小段已有笔记，回顾其中一个知识点，不追求一次复习很多。' },
    { key:'study-recall',title:'回想一个知识点',action:'先合上笔记回想一个知识点，再打开对照，补上没记住的部分。' },
    { key:'study-explain',title:'说清一个知识点',action:'选择正在学的一个小知识点，尝试用自己的话说明它。' }
  ],
  tidy: [
    { key:'tidy-surface',title:'整理一小块桌面',action:'只选眼前一小块桌面，把常用物品归位，暂不扩展到整个房间。' },
    { key:'tidy-group',title:'归位一类物品',action:'只整理一类手边物品，收进常用位置；不需要购买新的收纳用品。' },
    { key:'tidy-reset',title:'给桌面留点空间',action:'收走桌面暂时不用的物品，为下一次使用留出一小块位置。' }
  ],
  walk: [
    { key:'walk-easy',title:'轻松走一会儿',action:'在熟悉安全的地方按舒适节奏走一会儿，不追求速度；不适时停止。' },
    { key:'walk-break',title:'起身走一小段',action:'选择安全平坦的小路，按舒适节奏走一小段；不适时停止。' },
    { key:'walk-near',title:'在附近散散步',action:'在熟悉的附近选一小段安全路线轻松走走；不适时停止。' }
  ]
};
const REASONS = {
  'start-small':'先让开始变得容易，觉得合适后再调整目标；没有固定天数的养成保证。',
  'make-room':'在你本次可用时间里留一点余量，忙时也能选择更小的目标。',
  'keep-light':'把范围限定到一件具体的小事，完成后就可以停，不需要一次做很多。'
};
function selectionToDraft(selection,input) {
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).length!==4||
    Object.keys(selection).some(k=>!['actionKey','reasonKey','target','minimum'].includes(k)))throw Error('AI_RESULT_INVALID');
  const action=(ACTIONS[input.direction]||[]).find(x=>x.key===selection.actionKey);
  if(!action||typeof selection.reasonKey!=='string'||!Object.prototype.hasOwnProperty.call(REASONS,selection.reasonKey)||
    !Number.isInteger(selection.target)||selection.target<1||selection.target>input.minutes||
    (selection.minimum!==null&&(!Number.isInteger(selection.minimum)||selection.minimum<1||selection.minimum>=selection.target)))throw Error('AI_RESULT_INVALID');
  return validateDraft({title:action.title,action:action.action,reason:REASONS[selection.reasonKey],target:selection.target,minimum:selection.minimum,unit:'分钟'},input);
}
module.exports={ACTIONS,REASONS,selectionToDraft};
