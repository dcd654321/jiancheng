// 在受控本机终端从标准输入提供回调AES密钥；只输出定时器所需的派生Message。
// 不接受命令行密钥，不写文件，不连接云端。
const { mediaTimerSecret } = require('../server/supervision-gates');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk => {
  input += chunk;
  if (input.length > 100) { console.error('输入必须为43字符回调AES密钥'); process.exit(1); }
});
process.stdin.on('end',() => {
  try { process.stdout.write(mediaTimerSecret({HABIT_MEDIA_ENCODING_AES_KEY:input.trim()})+'\n'); }
  catch (_) { console.error('输入必须为43字符回调AES密钥'); process.exitCode = 1; }
  input = '';
});
