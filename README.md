# Transition 变迁

> 记录每一刻变迁 — 基于 Electron 42 的无边框毛玻璃桌面便签应用

## 技术栈
| 层 | 技术 |
|---|------|
| 框架 | Electron 42 (frame: false, transparent: true) |
| 数据库 | sql.js (SQLite, 存储于 userData/transition.db) |
| 前端 | 原生 HTML/CSS/JS (无框架依赖) |
| 通信 | IPC (ipcMain.handle / ipcRenderer.invoke + send/on 事件广播) |
| 语言 | 自定义 i18n 引擎, 6 种语言 (zh-CN/en-US/ja-JP/ko-KR/fr-FR/de-DE) |

---

## 项目结构
```
Transition变迁/
├── main.js                # 主进程: 数据库迁移、IPC、窗口生命周期、托盘
├── preload.js             # 预加载: contextBridge 暴露 transitionAPI
├── package.json           # Electron 42 + electron-builder
├── assets/transition.ico  # 应用图标
├── renderer/
│   ├── i18n.js            # 翻译引擎 (I18N.init / I18N.t)
│   ├── locales/           # 6 语言 JSON
│   │   ├── zh-CN.json     # 中文 (默认)
│   │   ├── en-US.json     # 英文
│   │   ├── ja-JP.json     # 日文
│   │   ├── ko-KR.json     # 韩文
│   │   ├── fr-FR.json     # 法文
│   │   └── de-DE.json     # 德文
│   ├── main.html/css/js   # 主窗口 (便签列表 + 编辑器)
│   ├── popup.html/css/js  # 桌面浮动便签小窗
│   ├── settings.html/css/js # 设置窗口
│   ├── timeline.html/css/js  # 时间线视图
│   ├── privacy.html/css/js   # 隐私政策窗口
│   └── about.html/css/js     # 关于窗口
```

---

## 数据库设计
```sql
notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title, content, color, created_at, updated_at,
  reminded_at, repeat_reminder, font_family, is_popup,
  sort_order REAL  -- 拖拽排序持久化
)
app_settings (
  key TEXT PRIMARY KEY,  -- theme, language, fontFamily, lightColor, darkColor, privacyShown, ...
  value TEXT
)
window_states (  -- 小窗位置/尺寸/折叠/置顶状态
  window_id TEXT UNIQUE, note_id, x, y, width, height,
  size_level, is_top, is_collapsed
)
reminders (  -- 提醒计划
  note_id, reminded_at, repeat_type, is_active
)
```

### 数据库迁移
- `sort_order` 列通过 ALTER TABLE 在 initDatabase 中自动添加 (REAL, 默认 NULL)
- `fontFamily`/`privacyShown`/`language`/`lightColor`/`darkColor` 在 initDatabase 中自动插入默认值

---

## 颜色系统

### 色板 (30+ 颜色, 5 分组)

| 分组 | 颜色 |
|------|------|
| 主题色 | 松石青 #0FBAB2, 浅松石青 #5DD5CD, 深松石青 #0A9E98, 青瓷绿 #8CB89A |
| 莫兰迪 | 灰粉 #CEADAE, 豆绿 #9BB79E, 燕麦米 #D8D1C4, 雾霾紫 #AAA7C1, 灰蓝 #8D9BB2, 奶茶棕 #C7B197, 浅灰 #BEC2C8, 干枯玫瑰 #BB9E9D |
| 敦煌 | 石青 #466E8C, 赭石 #966446, 月白 #E1E6EB, 藤黄 #C8AF64, 胭脂粉 #B4828C, 苍绿 #5A7D6E, 烟褐 #786455 |
| 马卡龙 | 奶蓝 #A0C3E1, 奶粉 #E6C3CD, 薄荷奶绿 #AFD7C3, 香芋奶紫 #C3B4D7, 奶油黄 #F5E1B4, 浅杏 #EBD7C3 |
| 洛可可 | 藕粉 #D2B4B9, 雾蓝 #8296B4, 鼠尾草绿 #87A596, 奶咖 #B9A591, 灰丁香紫 #A59BB9 |

### CSS 变量体系 (通过 applyThemeColors() 动态设置)

```
--mars-green        → 当前主题色
--glass-bg          → 外层毛玻璃背景 (主题色 + 透明度)
--panel-bg          → 面板/侧边栏背景 (浅色: 亮化, 深色: 暗化)
--text-primary      → 主文本 (浅色主题: #1e2d3d 深色, 深色主题: #E8E8E8 浅色)
--text-secondary    → 辅助文本 (浅色: #4a5c6e, 深色: #B0B0B0)
--btn-bg/hover/active → 按钮背景 (主题色 RGB + 透明度, JS 直设 DOM)
--border-color      → 边框 (浅色: white 30%, 深色: white 10%)
```

### 文本可读性策略
- 浅色主题: 文本固定深色 (#1e2d3d / #4a5c6e) — 主题色仅影响玻璃背景色调
- 深色主题: 文本固定浅色 (#E8E8E8 / #B0B0B0)
- 不再根据主题色亮度自动判断 (避免中亮色在浅底上输出白字)

---

## 关键 IPC 通道

| 通道 | 类型 | 方向 | 说明 |
|------|------|------|------|
| create-note | invoke | renderer→main | 创建便签 (含 sort_order 自动计算) |
| update-note | invoke | renderer→main | 更新便签 (同时通知对应小窗) |
| delete-note | invoke | renderer→main | 删除便签 |
| get-all-notes | invoke | renderer→main | 获取全部便签 (按 sort_order, updated_at 排序) |
| reorder-notes | invoke | renderer→main | 拖拽排序持久化 (事务批量更新) |
| get-color-palette | invoke | renderer→main | 获取完整色板 (5 组) |
| save-app-setting | invoke | renderer→main | 保存设置 + 广播 (theme→theme-changed+accent-color-changed, language→language-changed, lightColor/darkColor→accent-color-changed) |
| update-global-font | invoke | renderer→main | 保存字体 + 广播 font-changed 到所有窗口 |
| set-reminder | invoke | renderer→main | 设置提醒 |
| theme-changed | send | main→all | 主题切换通知 |
| language-changed | send | main→all | 语言切换通知 |
| accent-color-changed | send | main→all | 主题色变更通知 ({ theme, color }) |
| font-changed | send | main→all | 字体变更通知 |
| notes-changed | send | main→main+popup | 便签变更通知 (触发列表刷新和小窗同步) |
| update-popup-color | send | main→popup | 主窗口改色通知小窗 |
| color-changed | send | main→popup | 小窗颜色变更通知 |
| init-popup | send | main→popup | 小窗初始化参数 |
| popup-note-saved | send | popup→main | 小窗保存通知主窗口 (同时通知其他同 noteId 小窗) |

---

## 已解决的难题

### 难题 1: Electron 42 frameless + transparent 窗口最大化后无法还原
**症状**: 点击最大化后窗口铺满屏幕，再次点击无法还原到原始尺寸。日志显示 `setBounds` 调用成功但窗口不响应。

**根因**: Electron 42 在 Windows 上 `frame: false` + `transparent: true` 组合创建的是 `WS_EX_LAYERED` 分层窗口。当窗口尺寸恰好铺满屏幕工作区时，DWM 将 `SetWindowPos` 调用视为无效操作直接吞掉——这是 Windows 窗口管理器的底层行为。

**解决方案**: Nudge + Toggle BackgroundColor 组合
```javascript
// 还原时:
// 1. nudge 打破 DWM 对齐 (位移+缩小 50px)
win.setBounds({ x: bounds.x + 25, y: bounds.y + 25, ... });
// 2. toggle backgroundColor 重建分层表面
win.setBackgroundColor('#01000000');
// 3. 下一帧 setBounds 到目标
setTimeout(() => {
  win.setBounds(target);
}, 16);
```

**关键细节**:
- 不是用 `win.maximize()`/`win.unmaximize()` API，而是手动管理 bounds
- 通过比较 `bounds` 和 `workArea` 的宽高差 (< 50px 容差) 判断当前是否最大化
- `mainNormalBounds` 保存 restore 目标，用 `_restoring` 标志防止 resize 事件污染
- `forceRoundedShape()` 在 ready-to-show 后通过 1px nudge 触发 DWM 重新计算圆角

### 难题 2: 无边框圆角窗口的黑色直角问题
**症状**: 窗口四角出现黑色直角，与玻璃圆角设计不匹配。主窗口修复后设置/时间线窗口仍然存在。

**根因**: `frame: false` 窗口在 Chromium 渲染第一帧前，未裁剪区域显示为黑色。Web 层的 `border-radius: 16px` 无法裁剪原生窗口层。

**解决方案**:
1. 所有 BrowserWindow 设置 `backgroundColor: '#00000000'` (完全透明)
2. 所有 HTML 的 `body` 设置 `background: transparent`
3. `glass-pane` 容器设 `border-radius: 16px; overflow: hidden`
4. `forceRoundedShape(win)` 在 `ready-to-show` 后 100ms 执行，通过 ±1px nudge 强制 DWM 采用窗口圆角

### 难题 3: 多窗口主题色实时同步
**症状**: 在设置窗口更改主题色后，仅主窗口跟随，其他窗口需重启才生效。

**根因**: `applyThemeColors()` 函数仅存在于 `renderer/main.js`，其他窗口的 `onAccentColorChanged` 只设 `--mars-green` 但未重新计算 `--glass-bg`、`--panel-bg`、`--text-primary`、`--text-secondary` 等衍生色。

**解决方案**:
1. 将 `applyThemeColors()` 复制到所有 5 个渲染进程 (main/settings/timeline/popup/privacy)
2. 所有窗口的 `onThemeChanged` 和 `onAccentColorChanged` 回调中调用 `applyThemeColors(theme, color)`
3. 所有窗口 `init()` 中加载 settings 后立即调用 `applyThemeColors`
4. `main.js` 的 `save-app-setting` IPC 在 theme/lightColor/darkColor 变更时广播到全部窗口

### 难题 4: 按钮颜色不跟随主题色
**症状**: 窗口控制按钮 (关闭/最小化/最大化/设置) 始终显示硬编码的 `rgba(15,186,178,0.3)`，切换主题色后不改变。

**根因**: CSS 中 `rgba()` 不支持 CSS 变量作为颜色分量。`rgba(var(--mars-r), var(--mars-g), var(--mars-b), 0.3)` 在 CSS 中语法无效。

**解决方案**: 放弃纯 CSS 方案，改为 JS 直设 DOM
1. `applyThemeColors()` 中遍历 `.win-btn, .title-btn`，用 `style.backgroundColor` 直接内联设置
2. 同时设置 `--btn-bg`/`--btn-hover`/`--btn-active` CSS 变量 (用于 hover/active 伪类)
3. CSS 文件追加 `:hover { background: var(--btn-hover) !important }` 规则覆盖默认值
4. 所有 5 个窗口的 `init()` 和事件监听中均调用此函数，确保启动和主题切换时生效

### 难题 5: 文本在浅色主题下不可读
**症状**: 部分主题色（尤其是偏暗色调）在浅色模式下，文本被设为白色，在浅色毛玻璃背景上不可读。

**根因**: 旧代码根据主题色亮度自动判断文本颜色 (`lum > 0.55 ? 深色 : 白色`)。但毛玻璃背景是浅色调的（主题色 +180 RGB 偏移），实际背景远亮于主题色本身。

**解决方案**: 放弃亮度自动判断，按主题模式固定文本颜色

| 主题 | --text-primary | --text-secondary |
|------|---------------|-----------------|
| 浅色 | #1e2d3d (深蓝黑) | #4a5c6e (灰蓝) |
| 深色 | #E8E8E8 (浅灰白) | #B0B0B0 (中灰) |

---

## 运行

---


```bash
# 安装依赖
npm install

# 开发运行
npm start

# 打包
npm run dist
```