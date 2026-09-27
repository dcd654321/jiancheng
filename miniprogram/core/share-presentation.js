const domain = require('./habits');
const dates = require('./date');
const LABELS = { read: '读一会儿', walk: '走路一会儿', study: '复习一小段', tidy: '整理桌面' };
const CAPTIONS = { 'small-steps': '每天一小步，也在向前。', 'keep-going': '不必完美，今天继续。', 'busy-still-counts': '忙时少做一点，也值得记录。' };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function present(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw Error('分享内容格式无效');
  if (snapshot.kind === 'invite' && snapshot.coverKey === 'default') {
    return { title: '再忙，也能做一点', subtitle: '渐成习惯打卡', lines: ['为阅读、运动、学习设一个小目标。', '忙时调小一点，做完再打卡。'], kind: 'invite', canCopy: false };
  }
  if (snapshot.kind === 'plan' && own(LABELS, snapshot.categoryKey)) {
    if (!Number.isInteger(snapshot.target) || !Number.isInteger(snapshot.minimum)) throw Error('目标格式无效');
    const plan = domain.validatePlan({ title: LABELS[snapshot.categoryKey], target: snapshot.target, minimum: snapshot.minimum,
      unit: snapshot.unit, weekdays: snapshot.weekdays || [1,2,3,4,5,6,7], time: '' });
    if (!plan.minimum) throw Error('缺少忙时目标');
    return { kind: 'plan', title: plan.title, subtitle: '平时目标 + 忙时小目标', canCopy: true,
      lines: ['平时 ' + plan.target + plan.unit, '忙时 ' + plan.minimum + plan.unit,
        snapshot.weekdays ? domain.weekdayText(plan.weekdays) : '执行日期未公开，创建时可以自己选'], plan };
  }
  if (snapshot.kind === 'weekly' && own(CAPTIONS, snapshot.captionKey)) {
    dates.assertDate(snapshot.startDate); dates.assertDate(snapshot.endDate);
    if (dates.shift(snapshot.startDate,6) !== snapshot.endDate || ['planned','standard','minimum'].some(k=>!Number.isInteger(snapshot[k]) || snapshot[k]<0 || snapshot[k]>35) ||
      snapshot.standard + snapshot.minimum > snapshot.planned) throw Error('进展格式无效');
    return { kind: 'weekly', title: '这一周，每一点都算数', subtitle: snapshot.startDate + ' 至 ' + snapshot.endDate,
      lines: ['完成 ' + (snapshot.standard + snapshot.minimum) + ' / ' + snapshot.planned + ' 次安排',
        '原目标 ' + snapshot.standard + ' 次 · 忙时小目标 ' + snapshot.minimum + ' 次', CAPTIONS[snapshot.captionKey]], canCopy: false };
  }
  throw Error('不支持的分享内容');
}
module.exports = { present, LABELS, CAPTIONS };
