# H5Player 视频监控播放器

基于海康威视 **h5player v2.5.1** API 开发的网页版视频监控播放器，提供现代化的深色主题 UI 界面。

## 功能特性

### 实时预览
- 支持 WebSocket (ws/wss) 流媒体播放
- 普通模式 / 高级模式解码切换
- 安全认证 Token 支持

### 录像回放
- 绝对时间正放 / 倒放
- 快放（最高8倍速）/ 慢放（最低1/8速）
- 直接倍数设置 (⅛x / ¼x / ½x / 1x / 2x / 4x / 8x)
- 单帧进 / 单帧退
- 正/倒放快速切换
- 暂停 / 恢复

### 音频控制
- 开启/关闭声音
- 音量调节 (1-100)
- 静音切换

### 录像与截图
- MP4 格式录像，停止后自动下载
- JPEG 格式截图，自动下载到本地

### 画面调整
- 电子放大（拖拽放大指定区域）
- 旋转（0° / 90° / 180° / 270°）
- 缩放比例（铺满 / 原始 / 16:9 / 4:3 / 9:16 / 3:4）

### 分屏显示
- 1×1 / 2×2 / 3×3 分屏

### 语音对讲
- 仅支持 HTTPS 环境
- 对讲音量调节

### 其他
- 实时 OSD 时间显示
- 视频信息面板（编码、分辨率、帧率、码率）
- 全屏 / 单窗全屏
- 操作状态日志

## 使用方法

### 1. 引入 h5player

将 `h5player.min.js` 及配套解码库放入 `dist/` 目录（与 `h5player.min.js` 同级）：

```
h5player-demo/
├── index.html
├── player.css
├── player.js
└── dist/
    ├── h5player.min.js   ← 从官方SDK获取
    └── ...               ← 其他解码库文件
```

在 `index.html` 底部加入：

```html
<script src="dist/h5player.min.js"></script>
<script src="player.js"></script>
```

### 2. 启动页面

使用支持 HTTPS 的 Web 服务器访问（wss 协议需要 HTTPS）：

```bash
# 示例：使用 Python 简单HTTP服务器
python3 -m http.server 8080

# 或使用 nginx / apache 配置 HTTPS
```

### 3. 配置播放

1. 在「流媒体配置」面板输入视频流 URL，格式如：
   ```
   wss://192.168.1.100:6014/proxy/.../EUrl/xxxxx
   ```
2. 选择解码模式（普通模式兼容性更好）
3. 如需安全认证，填入 Token
4. 点击「开始播放」

### 浏览器要求

| 功能 | 要求 |
|------|------|
| 普通模式 | Chrome 80+，Firefox，Edge |
| 高级模式 | Chrome 80+，iOS Safari，Android Browser |
| 电子放大/单帧 | Chrome 94+，HTTPS |
| 对讲 | Chrome，HTTPS |

### 常见问题

**Q: 页面打开后显示"演示模式"？**  
A: 需要将官方 `h5player.min.js` 放入 `dist/` 目录并在 HTML 中引入。

**Q: wss 连接失败？**  
A: 需要安装平台根证书，并在 HTTPS 环境下访问。错误码 `0x12f910019`。

**Q: 无法打开声音？**  
A: 需要等待首帧显示后才能开启声音。倍速播放时不支持声音。

**Q: 性能不足？**  
A: 关闭其他占用 GPU/CPU 的程序，或减少分屏数量。高级模式下建议开启 `mseWorkerEnable: true`（分辨率大于1080P时）。

## 错误码参考

主要错误码见 `h5player v2.5.1` 开发指南第39-40页。
