# 渐成习惯打卡：平台基本资料

名称：渐成习惯打卡

简称：渐成习惯

介绍（可直接复制，49个字符）：

支持阅读、学习、运动等习惯打卡，自定义目标与执行星期，查看养成进度。忙时简化目标，每天进步一小步。

名称与简称在用户提供的后台截图中均显示可使用；该状态不是最终审核或商标权利确认。未代替用户点击提交。

上传头像使用 [jiancheng-avatar-v1.png](./jiancheng-avatar-v1.png)。成品采用深绿底、浅色勾选、新芽和起步小方块；无文字，保留圆形裁剪安全区域。实际后台预览需上传后确认。本目录在 miniprogramRoot 外，仅作平台上传素材，不增加小程序运行包的图片依赖。

文件已核验：PNG，1254×1254像素，966503字节（约944 KiB），低于截图中的2MB上限；角落像素alpha为255，深绿底。截图中的144×144为建议尺寸，不是展示的强制尺寸。若后台另提示尺寸限制，再按具体提示处理。

使用内置 image_gen 生成及修订；未用CLI/API回退。初版透明底已放弃，最终版为深绿实底。未修改页面代码、AppID、云环境、存储格式或已有记录。

## 最终提示词记录

### 初次生成

Use case: logo-brand.
Asset type: final upload-ready square WeChat Mini Program avatar, one single icon, not a presentation.
Primary request: create an original, polished minimalist app symbol for the Chinese habit-tracking product 渐成习惯打卡, whose idea is small daily actions gradually becoming habits. Do not render the brand name or any letters.
Scene/backdrop: solid uniform deep forest green #245c44 filling the ENTIRE square canvas edge-to-edge; opaque, no outside white border and no pre-rounded canvas corners.
Subject: a distinctive, bold, softly rounded ivory-white checkmark with an upward-growing character; a small fresh lime #ddf3a4 leaf naturally integrated at the upper tip of its long rising stroke evokes gradual growth. One small detached lime rounded-square step near the lower-left start evokes a first daily check-in. These should read as ONE coherent simple graphic mark, not separate illustrations.
Style/medium: impeccably clean flat vector-like logo rendered as PNG; crisp smooth edges, restrained organic geometry, strong silhouette, professionally balanced negative space. Friendly calm everyday productivity tool for adults, not corporate certification or a medical brand.
Composition/framing: centered with optical balance, emblem occupies about 58% of canvas width and 56% height, ample at least 20% safe margin around it, all important parts remain legible inside a circular crop. Strong recognition at 32px and 144px.
Output: one 1024x1024 square PNG icon, preferably below 2MB through simple flat colors.
Constraints: no text, no letters, no numbers, no calendar grids, no thin lines, no gradients, no shadows, no 3D, no mockup, no phone, no watermark, no border, no multiple variants, do not imitate an existing brand.

### 成品修订

Use case: precise-object-edit. Input image is the edit target: the generated habit app symbol.
Change ONLY the background and clean the ragged antialiasing of the symbol. Preserve the exact centered checkmark + lime sprout + detached lime small square concept and overall positions.
CRITICAL: Produce a completely OPAQUE, fully flattened square image. Fill ALL transparent pixels and the WHOLE square canvas, including all four corners, with solid forest green #245c44. The green background is part of the artwork and MUST NOT be removed. This is a finished green square tile for direct upload, NOT an isolated logo cutout. No transparency whatsoever. Keep ivory-white check and lime-green accents with smooth clean edges, no thin fringes. No text, no added decorations, no border, no surrounding white area, no shadows.
Output one square PNG suitable for WeChat avatar, preserve generous circular-crop safe margins.

### 成品保存重试（最终调用）

Use case: precise-object-edit. Use the most recent generated image, the opaque deep forest green square with ivory checkmark, lime sprout and little lime square, as the target. Reproduce this exact completed image without changing its design or composition. Preserve the entire solid opaque forest-green background including all four corners; absolutely no transparency or background removal. Single square PNG image, no text, no frame, no scene, suitable for direct upload as a WeChat habit tracker avatar. Keep clean smooth edges and the same central graphic. Do not use the earlier transparent version.
