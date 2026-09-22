// 自编短句，随包发布；不读取习惯内容、不联网。索引只用于避免相邻冷启动重复。
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
const QUOTE_KEY = 'yidian.native.quote-index.v1';

function createQuoteSession(storage, random = Math.random) {
  let selected;
  return {
    current() {
      if (selected !== undefined) return selected;
      let previous;
      try { previous = storage.getStorageSync(QUOTE_KEY); } catch (_) { /* 装饰内容不能阻塞打卡 */ }
      let index = 0;
      if (Number.isInteger(previous) && previous >= 0 && previous < QUOTES.length) {
        let sample = 0;
        try { sample = random(); } catch (_) { /* 固定回退仍排除上次短句 */ }
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1) sample = 0;
        const offset = Math.floor(sample * (QUOTES.length - 1));
        index = offset >= previous ? offset + 1 : offset;
      }
      selected = QUOTES[index];
      try { storage.setStorageSync(QUOTE_KEY, index); } catch (_) { /* 只失去跨启动去重，不影响习惯存储 */ }
      return selected;
    }
  };
}

module.exports = { QUOTES, QUOTE_KEY, createQuoteSession };
