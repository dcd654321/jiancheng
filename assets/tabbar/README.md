# 底部导航图标资产

用途：微信小程序原生 `tabBar`，对应“今日 / 进度 / 我的”。用户已确认采用绿色极简线性风格。

## 设计基线

- 画布：81×81像素透明PNG，RGBA；图形位于安全区内。
- 线条：5像素、圆头、圆角连接；三组图标保持相同视觉重量。
- 未选中：`#65756c`，与 `app.json` 的普通文字色一致。
- 已选中：`#245c44`，与产品主色及 `app.json` 的选中色一致。
- 今日：圆形打卡框＋勾，表示今天完成一小步。
- 进度：三档增长线＋上升折线，表示习惯积累趋势。
- 我的：头像轮廓，表示个人记录与设置。
- 图标只承担导航识别，不加入文字、底板、阴影、渐变或装饰徽章。

## 文件与再生成

运行时文件位于 `miniprogram/assets/tabbar/`，每个Tab包含普通态和 `-selected` 选中态，共6张PNG。矢量绘制源保存在 `scripts/generate-tab-icons.cjs`，生成时需要Node环境可解析 `sharp`；生成结果已提交到小程序目录，普通开发和发布不需要运行生成脚本或安装前端依赖。

本机生成命令：

```powershell
$env:NODE_PATH='C:\Users\dcd\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& 'C:\Users\dcd\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'scripts\generate-tab-icons.cjs'
```

验收要求：六张图必须存在、尺寸81×81、RGBA透明、单张不超过40 KiB；微信开发者工具需重新载入顶层 `app.json` 后再判断是否显示。
