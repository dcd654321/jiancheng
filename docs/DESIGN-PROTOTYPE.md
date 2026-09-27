# 渐成习惯打卡 · 原型图

> 配套：[概设](DESIGN-CONCEPT.md) · [详设](DESIGN-DETAIL.md) · [数据库设计](DESIGN-DATABASE.md)
> 本页截图来自微信开发者工具原生模拟器（363×785），为 B020 评审整改后版本（2026-09-21）。原始文件在 `docs/evidence-b020/`。

## 1. 视觉规范

| 项 | 值 |
| --- | --- |
| 背景 | `#ffffff` |
| 主文字 | `#183b31` |
| 主操作（绿） | `#245c44` |
| 轻反馈（浅绿） | `#ddf3a4` |
| 分隔线 | `#e8ede7` |
| 次要文字 | `#65756c` |
| 字体 | 系统中文无衬线；标题 22px/700、区块 18px/600、正文 16px、说明 14px |
| 排版 | 左右 20px 边距，开放列表 + 细分隔线，无阴影卡片堆叠 |
| 星期 | 固定七列、间距 4px、按钮 48px 高 |
| 主按钮 | 至少 48px 高，跟随页面滚动 |
| 导航 | 原生顶部导航 + 底部「今日/进度/我的」三 Tab；详情用原生返回栈 |

## 2. 页面导航

```mermaid
flowchart TD
    TODAY["今日（Tab）"] --> EDIT["编辑 / 添加习惯"]
    TODAY --> DETAIL["习惯详情"]
    TODAY --> ASSISTANT["计划助手"]
    TODAY --> SYNC["数据同步"]
    PROGRESS["进度（Tab）"] --> DETAIL
    MINE["我的（Tab）"] --> MANAGE["习惯管理"]
    MINE --> DATA["数据管理"]
    MINE --> SYNC
    DATA --> SYNC
    DATA --> RESTORE["导出与找回"]
    ASSISTANT --> EDIT
    EDIT --> DETAIL
    MANAGE --> DETAIL
    DETAIL --> EDIT
```

## 3. 页面截图

### 3.1 今日（首页）

![今日](evidence-b020/01-today.png)

### 3.2 添加习惯（默认 / 更多设置展开）

![添加习惯](evidence-b020/02-create.png)
![添加习惯·更多设置](evidence-b020/03-create-options.png)

### 3.3 进度

![进度](evidence-b020/04-progress.png)

### 3.4 习惯详情（含更多操作）

![详情](evidence-b020/05-detail.png)
![详情·更多操作](evidence-b020/06-detail-actions.png)

### 3.5 我的

![我的](evidence-b020/07-mine.png)

### 3.6 数据管理

![数据管理](evidence-b020/08-data.png)
![数据管理·底部](evidence-b020/09-data-bottom.png)

### 3.7 导出与找回

![导出与找回](evidence-b020/10-backup.png)

### 3.8 计划助手（建议预览 / 带入表单）

![计划助手](evidence-b020/11-assistant.png)
![计划建议预览](evidence-b020/12-plan-preview.png)
![带入确认表单](evidence-b020/13-adopted-form.png)

### 3.9 数据同步

![数据同步](evidence-b020/14-sync.png)

### 3.10 习惯管理 / 编辑习惯

![习惯管理](evidence-b020/15-manage.png)
![编辑习惯](evidence-b020/16-edit.png)

## 4. 说明

- 以上为实机模拟器截图，非设计稿；视觉沿用既有方案而非像素复刻旧原型。
- 旧原型中的大口号、积分、三阶段计划已按评审移除，当前以任务、计数、表单为主要层级。
- 更早版本（B019 / 363px 发布版 / 390px）截图在 `docs/evidence-b019-20260920/` 与 `docs/evidence-*.png`，仅供历史追溯。
