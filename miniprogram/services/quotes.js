// 自编短句，随包发布；不读取习惯内容、不联网，也不写本机存储。
const QUOTES = Object.freeze([
  '一点，也算向前。',
  '今天的小事，今天慢慢做。',
  '先开始两分钟，也很好。',
  '忙的时候，可以把目标放小。',
  '不用补齐过去，从今天继续。',
  '做一点，再给自己一点时间。',
  '休息也是安排的一部分。',
  '适合自己的节奏，才值得留下。',
  '不必每次都做很多。',
  '让小事轻一点，让开始容易一点。'
]);
function createQuoteSession(random = Math.random) {
  let selected;
  return {
    current() {
      if (selected !== undefined) return selected;
      let sample = 0;
      try { sample = random(); } catch (_) { /* 装饰内容不能阻塞打卡 */ }
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) sample = 0;
      const index = Math.floor(sample * QUOTES.length);
      selected = QUOTES[index];
      return selected;
    }
  };
}

module.exports = { QUOTES, createQuoteSession };
