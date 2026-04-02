/**
 * H5Player 播放器 UI 控制器
 * 对接 JSPlugin (h5player v2.5.1) API
 *
 * 关键修正（对照官方 demo.html）：
 * 1. szBasePath 指向实际 h5player.min.js 所在目录 "../h5player/demo"
 * 2. 用 player.currentWindowIndex 替代手动维护 curIndex
 * 3. 回放时间格式统一为 "YYYY-MM-DDTHH:mm:ss.000+08:00"
 * 4. JS_Stop/JS_Fast/JS_Slow/JS_Resume 不传参数（自动用 currentWindowIndex）
 * 5. 补全 StreamHeadChanged / ElementChanged 回调
 * 6. 补全即时回放、缩略图、水印、智能信息、对讲录音功能
 */

(function () {
  'use strict';

  // ===== 全局状态 =====
  const state = {
    player: null,
    mode: 'preview',        // 'preview' | 'playback'
    decodeMode: 0,          // 0=普通 1=高级
    soundOpen: false,
    recording: false,
    zoomEnabled: false,
    currentRate: 1,
  };

  // ===== DOM 工具 =====
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== 日志 =====
  function log(msg, type = 'default') {
    const c = $('log-container');
    if (!c) return;
    const now = new Date();
    const t = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.innerHTML = `<span class="log-time">${t}</span><span class="log-msg">${esc(msg)}</span>`;
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ===== Toast =====
  function toast(msg, type = 'info') {
    const c = $('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
      el.classList.add('hiding');
      setTimeout(() => el.remove(), 220);
    }, 3000);
  }

  // ===== 时间格式转换 =====
  // datetime-local 值: "2023-08-16T00:00:00" → "2023-08-16T00:00:00.000+08:00"
  function toPlaybackTime(localStr) {
    if (!localStr) return undefined;
    const clean = localStr.replace(/\.\d+$/, '');           // 去掉已有毫秒
    return clean + '.000+08:00';
  }

  function formatTs(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
      + `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // ===== 创建/初始化播放器 =====
  function createPlayer() {
    if (typeof JSPlugin === 'undefined') {
      log('未找到 h5player.min.js，请确认引入路径', 'error');
      toast('未找到 h5player.min.js', 'error');
      showDemoPlaceholder();
      return;
    }

    state.player = new JSPlugin({
      szId: 'player',
      // 必须与 h5player.min.js 所在目录一致
      szBasePath: '../h5player/demo',
      iMaxSplit: 4,
      iCurrentSplit: 1,
      openDebug: false,
      mseWorkerEnable: false,
      bSupporDoubleClickFull: true,
      oStyle: {
        borderSelect: '#FFCC00',
      },
    });

    state.player.JS_SetWindowControlCallback({
      windowEventSelect: function (iWndIndex) {
        log(`选中窗口: ${iWndIndex}`, 'info');
      },
      pluginErrorHandler: function (iWndIndex, iErrorCode, oError) {
        const hex = '0x' + Number(iErrorCode).toString(16).toUpperCase();
        const desc = oError && oError.info ? oError.info : '';
        log(`窗口[${iWndIndex}] 错误 ${hex} ${desc}`, 'error');
        toast(`播放错误 ${hex}`, 'error');
      },
      windowEventOver: function () {},
      windowEventOut: function () {},
      windowEventUp: function () {},
      windowFullCcreenChange: function (bFull) {
        log(`全屏: ${bFull ? '开' : '关'}`, 'info');
      },
      firstFrameDisplay: function (iWndIndex, iWidth, iHeight) {
        log(`首帧 窗口[${iWndIndex}] ${iWidth}×${iHeight}`, 'success');
        fetchVideoInfo();
        startOSDPoll();
      },
      performanceLack: function () {
        log('性能不足，可能影响播放', 'warning');
        toast('性能不足', 'warning');
      },
      StreamEnd: function (iWndIndex) {
        log(`回放结束 窗口[${iWndIndex}]`, 'info');
        toast(`窗口[${iWndIndex}] 回放结束`, 'info');
        stopOSDPoll();
      },
      StreamHeadChanged: function (iWndIndex) {
        log(`流头变更 窗口[${iWndIndex}]`, 'info');
        fetchVideoInfo();
      },
      ThumbnailsEvent: function (iWndIndex, eventType, eventCode) {
        log(`缩略图事件 窗口[${iWndIndex}] type:${eventType} code:${eventCode}`, 'info');
      },
      InterruptStream: function (iWndIndex, iTime) {
        log(`断流 窗口[${iWndIndex}] ${iTime}s`, 'warning');
      },
      ElementChanged: function (iWndIndex, szElementType) {
        log(`渲染元素 窗口[${iWndIndex}] → ${szElementType}`, 'info');
      },
    }).then(() => {
      log('JSPlugin 初始化成功', 'success');
      // 监听窗口大小变化自动 resize
      window.addEventListener('resize', () => {
        state.player && state.player.JS_Resize();
      });
    }).catch((e) => {
      log(`JSPlugin 初始化失败: ${e}`, 'error');
    });
  }

  function showDemoPlaceholder() {
    const c = $('player');
    if (!c) return;
    c.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:#000;';
    c.innerHTML = `
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
        <circle cx="28" cy="28" r="26" stroke="#2d4060" stroke-width="2"/>
        <polygon points="22,18 44,28 22,38" fill="#3b82f6" opacity="0.5"/>
      </svg>
      <div style="font-size:13px;color:#94a3b8">请确认 h5player.min.js 引入路径后刷新页面</div>`;
  }

  // ===== OSD 时间轮询 =====
  let osdTimer = null;
  function startOSDPoll() {
    if (osdTimer) return;
    osdTimer = setInterval(() => {
      if (!state.player) return;
      state.player.JS_GetOSDTime(state.player.currentWindowIndex)
        .then((ms) => {
          if (ms) {
            const d = new Date(ms);
            $('osd-time-display').textContent =
              `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          }
        }).catch(() => {});
    }, 1000);
  }
  function stopOSDPoll() {
    if (osdTimer) { clearInterval(osdTimer); osdTimer = null; }
    $('osd-time-display').textContent = '--:--:--';
  }

  // ===== 视频信息 =====
  function fetchVideoInfo() {
    if (!state.player) return;
    state.player.JS_GetVideoInfo(state.player.currentWindowIndex)
      .then((info) => {
        $('info-codec').textContent = info.VideType || '--';
        $('info-resolution').textContent = (info.width && info.height) ? `${info.width}×${info.height}` : '--';
        $('info-framerate').textContent = info.frameRate ? `${info.frameRate} fps` : '--';
        $('info-bitrate').textContent = info.bitRate ? `${info.bitRate} Kbps` : '--';
        $('info-audio').textContent = info.audioType || '--';
        $('info-format').textContent = info.systemFormt || '--';
      }).catch(() => {});
  }
  function resetVideoInfo() {
    ['info-codec', 'info-resolution', 'info-framerate', 'info-bitrate', 'info-audio', 'info-format']
      .forEach((id) => { $(id).textContent = '--'; });
  }

  // ===== 预览 =====
  function handleRealplay() {
    if (!state.player) { toast('播放器未就绪', 'warning'); return; }
    const playURL = $('realplay-url').value.trim();
    if (!playURL) { toast('请输入预览 URL', 'warning'); return; }
    const token = $('auth-token').value.trim();
    const index = state.player.currentWindowIndex;

    state.player.JS_SetTraceId(index, true);
    state.player.JS_Play(
      playURL,
      { playURL, mode: state.decodeMode, keepDecoder: 0, ...(token ? { token } : {}) },
      index
    ).then(() => {
      log('预览成功', 'success');
      toast('预览成功', 'success');
      state.player.JS_GetTraceId(index).then((id) => log(`traceId: ${id}`, 'info')).catch(() => {});
    }).catch((e) => {
      log(`预览失败: ${JSON.stringify(e)}`, 'error');
      toast('预览失败，请检查 URL 和网络', 'error');
    });
  }

  function handleStop() {
    if (!state.player) return;
    // JS_Stop 不传参时自动使用 currentWindowIndex
    state.player.JS_Stop().then(() => {
      log('停止成功', 'success');
      stopOSDPoll();
      resetVideoInfo();
    }).catch((e) => log(`停止失败: ${e}`, 'error'));
  }

  function handleStopAll() {
    if (!state.player) return;
    state.player.JS_StopRealPlayAll().then(() => {
      log('停止全部成功', 'success');
      stopOSDPoll();
      resetVideoInfo();
    }).catch((e) => log(`停止全部失败: ${e}`, 'error'));
  }

  // ===== 回放 =====
  function handlePlayback(reverse = false) {
    if (!state.player) { toast('播放器未就绪', 'warning'); return; }
    const playURL = $('playback-url').value.trim();
    if (!playURL) { toast('请输入回放 URL', 'warning'); return; }
    const s = $('start-time').value;
    const e = $('end-time').value;
    if (!s || !e) { toast('请选择回放时间段', 'warning'); return; }
    const token = $('auth-token').value.trim();
    const index = state.player.currentWindowIndex;
    const startTime = toPlaybackTime(s);
    const endTime = toPlaybackTime(e);
    const config = {
      playURL,
      mode: state.decodeMode,
      keepDecoder: 0,
      PlayBackMode: reverse ? 3 : 1,
      ...(token ? { token } : {}),
    };
    state.player.JS_Play(playURL, config, index, startTime, endTime)
      .then(() => {
        state.currentRate = 1;
        updateRateDisplay(1);
        log(`${reverse ? '倒向' : '正向'}回放成功`, 'success');
        toast(`${reverse ? '倒向' : '正向'}回放成功`, 'success');
      })
      .catch((err) => {
        log(`回放失败: ${JSON.stringify(err)}`, 'error');
        toast('回放失败', 'error');
      });
  }

  function handlePause() {
    if (!state.player) return;
    state.player.JS_Pause(state.player.currentWindowIndex)
      .then(() => log('暂停', 'info'))
      .catch((e) => log(`暂停失败: ${e}`, 'error'));
  }

  function handleResume(forward = true) {
    if (!state.player) return;
    state.player.JS_Resume(state.player.currentWindowIndex, forward)
      .then(() => log(`恢复${forward ? '正向' : '倒向'}播放`, 'info'))
      .catch((e) => log(`恢复失败: ${e}`, 'error'));
  }

  function handleFrameForward() {
    if (!state.player) return;
    state.player.JS_FrameForward(state.player.currentWindowIndex)
      .then(() => { updateRateDisplay(1); log('单帧进', 'info'); })
      .catch((e) => log(`单帧进失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleFrameBack() {
    if (!state.player) return;
    state.player.JS_FrameBack(state.player.currentWindowIndex)
      .then(() => { updateRateDisplay(1); log('单帧退', 'info'); })
      .catch((e) => log(`单帧退失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleFast() {
    if (!state.player) return;
    // 官方 demo: JS_Fast 不传 windowIndex
    state.player.JS_Fast()
      .then((rate) => { state.currentRate = rate; updateRateDisplay(rate); log(`快放 ${rate}x`, 'info'); })
      .catch((e) => {
        const code = e && e.errorCode;
        if (code === 0x12f910021) toast('已是最大倍速', 'warning');
        else log(`快放失败: ${JSON.stringify(e)}`, 'error');
      });
  }

  function handleSlow() {
    if (!state.player) return;
    state.player.JS_Slow()
      .then((rate) => { state.currentRate = rate; updateRateDisplay(rate); log(`慢放 ${rate}x`, 'info'); })
      .catch((e) => {
        const code = e && e.errorCode;
        if (code === 0x12f910022) toast('已是最小倍速', 'warning');
        else log(`慢放失败: ${JSON.stringify(e)}`, 'error');
      });
  }

  function handleSpeed() {
    if (!state.player) return;
    const rate = parseFloat($('speed-select').value);
    state.player.JS_Speed(state.player.currentWindowIndex, rate)
      .then((r) => { state.currentRate = r; updateRateDisplay(r); log(`倍速 ${r}x`, 'info'); })
      .catch((e) => log(`倍速失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleChangeMode() {
    if (!state.player) return;
    state.player.JS_ChangeMode(state.player.currentWindowIndex)
      .then(() => log('正/倒放切换成功', 'info'))
      .catch((e) => log(`切换失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleSeek() {
    if (!state.player) return;
    const seekStart = $('seek-time').value;
    const endTime = $('end-time').value;
    if (!seekStart) { toast('请选择定位时间', 'warning'); return; }
    const t1 = toPlaybackTime(seekStart);
    const t2 = toPlaybackTime(endTime || seekStart);
    state.player.JS_Seek(state.player.currentWindowIndex, t1, t2)
      .then(() => log(`定位: ${t1}`, 'success'))
      .catch((e) => log(`定位失败: ${JSON.stringify(e)}`, 'error'));
  }

  function updateRateDisplay(rate) {
    const rateMap = { '-8': '⅛', '-4': '¼', '-2': '½' };
    const display = rateMap[String(rate)] ? rateMap[String(rate)] + 'x' : `${rate}x`;
    $('current-rate').textContent = display;
  }

  // ===== 即时回放 =====
  function handleInstantOpen() {
    if (!state.player) return;
    const bInstantTime = parseInt($('instant-time').value);
    state.player.JS_InstantSetParam(state.player.currentWindowIndex, { bOpenflag: true, bInstantTime })
      .then(() => { log(`即时回放参数已设置: ${bInstantTime}s`, 'success'); toast('即时回放已开启，请等待 2 秒后再开始', 'success'); })
      .catch((e) => log(`即时回放参数失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleInstantStart() {
    if (!state.player) return;
    state.player.JS_StartInstant(state.player.currentWindowIndex)
      .then(() => log('即时回放已开始', 'success'))
      .catch((e) => {
        const code = e && e.errorCode;
        if (code === 0x12f910041) toast('缓冲区无数据，请等待2秒后重试', 'warning');
        else log(`即时回放开始失败: ${JSON.stringify(e)}`, 'error');
      });
  }

  function handleInstantStop() {
    if (!state.player) return;
    state.player.JS_StopInstant(state.player.currentWindowIndex)
      .then(() => log('即时回放已停止，跳回预览', 'info'))
      .catch((e) => log(`即时回放停止失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleInstantTotal() {
    if (!state.player) return;
    state.player.JS_InstantTotalDuration(state.player.currentWindowIndex)
      .then((t) => { log(`即时回放总时长: ${t}s`, 'info'); toast(`总时长: ${t}s`, 'info'); })
      .catch((e) => log(`获取总时长失败: ${e}`, 'error'));
  }

  function handleInstantCurr() {
    if (!state.player) return;
    state.player.JS_InstantCurrDuration(state.player.currentWindowIndex)
      .then((t) => { log(`即时回放当前: ${t}s`, 'info'); toast(`当前播放: ${t}s`, 'info'); })
      .catch((e) => log(`获取当前时长失败: ${e}`, 'error'));
  }

  // ===== 对讲 =====
  function handleTalkStart() {
    if (!state.player) return;
    const url = $('talk-url').value.trim();
    if (!url) { toast('请输入对讲 URL', 'warning'); return; }
    const token = $('auth-token').value.trim();
    state.player.JS_StartTalk(url, token ? { token } : {})
      .then(() => { log('对讲已开启', 'success'); toast('对讲已开启（需 HTTPS）', 'success'); $('btn-talk-start').classList.add('active'); })
      .catch((e) => {
        log(`对讲失败: ${JSON.stringify(e)}`, 'error');
        toast('对讲需要 HTTPS 环境', 'error');
      });
  }

  function handleTalkStop() {
    if (!state.player) return;
    state.player.JS_StopTalk()
      .then(() => { log('对讲已停止', 'info'); $('btn-talk-start').classList.remove('active'); })
      .catch((e) => log(`停止对讲失败: ${e}`, 'error'));
  }

  function handleRecordTalk() {
    if (!state.player) return;
    const type = parseInt($('audio-type').value);
    const fileName = `talk_${formatTs(new Date())}.mp3`;
    state.player.JS_StartSaveTalk(fileName, type)
      .then(() => { log(`对讲录音开始: ${fileName}`, 'success'); $('btn-record-talk').classList.add('active'); })
      .catch((e) => log(`对讲录音失败: ${e}`, 'error'));
  }

  function handleStopRecordTalk() {
    if (!state.player) return;
    state.player.JS_StopSaveTalk()
      .then(() => { log('对讲录音已保存', 'success'); $('btn-record-talk').classList.remove('active'); })
      .catch((e) => log(`停止对讲录音失败: ${e}`, 'error'));
  }

  // ===== 音量 =====
  function handleOpenSound() {
    if (!state.player) return;
    state.player.JS_OpenSound()
      .then(() => { state.soundOpen = true; log('声音已开启', 'success'); })
      .catch((e) => {
        const code = e && e.errorCode;
        if (code === 0x12f900012) toast('请等待首帧显示后再开启声音', 'warning');
        else log(`开声音失败: ${JSON.stringify(e)}`, 'error');
      });
  }

  function handleCloseSound() {
    if (!state.player) return;
    state.player.JS_CloseSound()
      .then(() => { state.soundOpen = false; log('声音已关闭', 'info'); })
      .catch((e) => log(`关声音失败: ${e}`, 'error'));
  }

  function handleVolumeChange(val) {
    $('volume-display').textContent = val;
    if (!state.player) return;
    state.player.JS_SetVolume(state.player.currentWindowIndex, parseInt(val))
      .catch((e) => log(`音量设置失败: ${e}`, 'error'));
  }

  // ===== 录像 =====
  function handleRecordStart(type) {
    if (!state.player) return;
    const codeMap = { MP4: 5, PS: 2 };
    const fileName = `record_${formatTs(new Date())}.mp4`;
    state.player.JS_StartSaveEx(
      state.player.currentWindowIndex,
      fileName,
      codeMap[type],
      { irecordType: 1 }
    ).then(() => {
      state.recording = true;
      $('btn-record-mp4').style.display = 'none';
      $('btn-record-ps').style.display = 'none';
      $('btn-record-stop').style.display = '';
      log(`录制 ${type} 开始: ${fileName}`, 'success');
      toast(`录制已开始 (${type})`, 'success');
    }).catch((e) => {
      log(`录制失败: ${JSON.stringify(e)}`, 'error');
      toast('录制失败，请先播放视频', 'error');
    });
  }

  function handleRecordStop() {
    if (!state.player) return;
    state.player.JS_StopSave(state.player.currentWindowIndex)
      .then(() => {
        state.recording = false;
        $('btn-record-mp4').style.display = '';
        $('btn-record-ps').style.display = '';
        $('btn-record-stop').style.display = 'none';
        log('录制已停止并保存', 'success');
        toast('录像已保存到本地', 'success');
      }).catch((e) => log(`停止录制失败: ${e}`, 'error'));
  }

  // ===== 截图 =====
  function handleCapture() {
    if (!state.player) return;
    const fileName = `img_${formatTs(new Date())}`;
    state.player.JS_CapturePicture(state.player.currentWindowIndex, fileName, 'JPEG')
      .then(() => { log(`截图已保存: ${fileName}.jpg`, 'success'); toast('截图已保存', 'success'); })
      .catch((e) => {
        const code = e && e.errorCode;
        if (code === 0x12f930011) toast('请等待首帧显示后再截图', 'warning');
        else log(`截图失败: ${JSON.stringify(e)}`, 'error');
      });
  }

  // ===== 电子放大 =====
  function handleZoomEnable() {
    if (!state.player) return;
    state.player.JS_EnableZoom(state.player.currentWindowIndex)
      .then(() => {
        state.zoomEnabled = true;
        $('btn-zoom-enable').style.display = 'none';
        $('btn-zoom-disable').style.display = '';
        log('电子放大已开启，拖拽选取区域', 'info');
      })
      .catch((e) => log(`开启电子放大失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleZoomDisable() {
    if (!state.player) return;
    state.player.JS_DisableZoom(state.player.currentWindowIndex)
      .then(() => {
        state.zoomEnabled = false;
        $('btn-zoom-enable').style.display = '';
        $('btn-zoom-disable').style.display = 'none';
        log('电子放大已关闭', 'info');
      })
      .catch((e) => log(`关闭电子放大失败: ${e}`, 'error'));
  }

  // ===== 旋转 & 缩放 =====
  function handleRotate() {
    if (!state.player) return;
    const degree = parseInt($('rotate-select').value);
    state.player.JS_Rotate(state.player.currentWindowIndex, degree)
      .then(() => log(`旋转: ${degree}°`, 'info'))
      .catch((e) => log(`旋转失败: ${e}`, 'error'));
  }

  function handleScale() {
    if (!state.player) return;
    const ratio = $('scale-select').value;
    state.player.JS_Scale(state.player.currentWindowIndex, ratio)
      .then(() => log(`缩放: ${ratio}`, 'info'))
      .catch((e) => log(`缩放失败: ${e}`, 'error'));
  }

  function handleScaleCancel() {
    if (!state.player) return;
    state.player.JS_ScaleCancel(state.player.currentWindowIndex)
      .then(() => {
        $('rotate-select').value = '0';
        $('scale-select').value = 'fill';
        log('已还原旋转/缩放', 'info');
      })
      .catch((e) => log(`还原失败: ${e}`, 'error'));
  }

  // ===== 智能信息 =====
  function handleIntellect(open) {
    if (!state.player) return;
    state.player.JS_RenderALLPrivateData(state.player.currentWindowIndex, open)
      .then(() => log(`智能信息: ${open ? '已开启' : '已关闭'}`, 'info'))
      .catch((e) => log(`智能信息失败: ${JSON.stringify(e)}`, 'error'));
  }

  // ===== 缩略图 =====
  function handleThumbnailsOpen() {
    if (!state.player) return;
    const playURL = $('playback-url').value.trim();
    const s = $('start-time').value;
    const e = $('end-time').value;
    if (!playURL || !s || !e) { toast('请先填写回放 URL 和时间段', 'warning'); return; }
    const token = $('auth-token').value.trim();
    state.player.JS_StartVideoThumbnails(
      state.player.currentWindowIndex,
      playURL,
      toPlaybackTime(s),
      toPlaybackTime(e),
      { snapwidth: 320, snapheight: 180, ...(token ? { token } : {}) }
    ).then(() => log('缩略图已开启', 'success'))
     .catch((e) => log(`开启缩略图失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleThumbnailsGet() {
    if (!state.player) return;
    const t = $('thumbnail-time').value;
    if (!t) { toast('请选择缩略图时间', 'warning'); return; }
    const videoTime = toPlaybackTime(t);
    state.player.JS_GetVideoThumbnails(
      state.player.currentWindowIndex,
      videoTime,
      function (timestamp, dataUrl) {
        log(`缩略图获取成功 ${timestamp}`, 'success');
        if (dataUrl) {
          $('thumbnail-img').src = dataUrl;
          $('thumbnail-preview').style.display = '';
        }
      }
    ).then(() => {}).catch((e) => log(`获取缩略图失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleThumbnailsClose() {
    if (!state.player) return;
    state.player.JS_StopVideoThumbnails(state.player.currentWindowIndex)
      .then(() => { log('缩略图已停止', 'info'); $('thumbnail-preview').style.display = 'none'; })
      .catch((e) => log(`停止缩略图失败: ${e}`, 'error'));
  }

  // ===== 水印 =====
  function handleWatermarkSet() {
    if (!state.player) return;
    const cfg = {
      text: $('wm-text').value || 'h5player',
      color: $('wm-color').value || undefined,
      font: $('wm-font').value || undefined,
      rotateDegree: parseInt($('wm-degree').value),
      space: parseInt($('wm-space').value),
    };
    if (!cfg.color) delete cfg.color;
    if (!cfg.font) delete cfg.font;
    if (isNaN(cfg.rotateDegree)) delete cfg.rotateDegree;
    if (isNaN(cfg.space)) delete cfg.space;
    state.player.JS_SetWatermarkConfig(cfg)
      .then(() => { log('水印已设置', 'success'); toast('水印已设置，截图时生效', 'success'); })
      .catch((e) => log(`水印设置失败: ${JSON.stringify(e)}`, 'error'));
  }

  function handleWatermarkCancel() {
    if (!state.player) return;
    state.player.JS_CancelWatermarkConfig()
      .then(() => log('水印已清除', 'info'))
      .catch((e) => log(`清除水印失败: ${e}`, 'error'));
  }

  // ===== 分屏 =====
  function handleSplit(n) {
    if (!state.player) return;
    state.player.JS_ArrangeWindow(n)
      .then(() => {
        log(`分屏: ${n}×${n}`, 'info');
        $$('.split-btn').forEach((b) => b.classList.toggle('active', parseInt(b.dataset.split) === n));
      })
      .catch((e) => log(`分屏失败: ${e}`, 'error'));
  }

  // ===== 全屏 =====
  function handleWholeFullscreen() {
    if (!state.player) return;
    state.player.JS_FullScreenDisplay(true)
      .then(() => log('整体全屏', 'info'))
      .catch((e) => log(`整体全屏失败: ${e}`, 'error'));
  }

  function handleSingleFullscreen() {
    if (!state.player) return;
    state.player.JS_FullScreenSingle(state.player.currentWindowIndex)
      .then(() => log('单窗全屏', 'info'))
      .catch((e) => log(`单窗全屏失败: ${e}`, 'error'));
  }

  // ===== 模式切换（预览/回放）=====
  function switchMode(mode) {
    state.mode = mode;
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const isPlayback = mode === 'playback';
    $('preview-section').style.display = isPlayback ? 'none' : '';
    $('instant-section').style.display = isPlayback ? 'none' : '';
    $('playback-section').style.display = isPlayback ? '' : 'none';
    $('playback-controls-section').style.display = isPlayback ? '' : 'none';
  }

  // ===== 绑定所有事件 =====
  function bindEvents() {
    // 模式切换
    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));

    // 解码模式
    $$('.tab-pill').forEach((b) => {
      b.addEventListener('click', () => {
        state.decodeMode = parseInt(b.dataset.mode);
        $$('.tab-pill').forEach((t) => t.classList.toggle('active', t === b));
        log(`解码模式: ${state.decodeMode === 0 ? '普通' : '高级'}`, 'info');
      });
    });

    // 分屏
    $$('.split-btn').forEach((b) => b.addEventListener('click', () => handleSplit(parseInt(b.dataset.split))));

    // 全屏
    $('btn-whole-fullscreen')?.addEventListener('click', handleWholeFullscreen);
    $('btn-single-fullscreen')?.addEventListener('click', handleSingleFullscreen);

    // 预览
    $('btn-realplay')?.addEventListener('click', handleRealplay);
    $('btn-stop-realplay')?.addEventListener('click', handleStop);
    $('btn-stopall')?.addEventListener('click', handleStopAll);
    $('realplay-url')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleRealplay(); });

    // 即时回放
    $('btn-instant-open')?.addEventListener('click', handleInstantOpen);
    $('btn-instant-start')?.addEventListener('click', handleInstantStart);
    $('btn-instant-stop')?.addEventListener('click', handleInstantStop);
    $('btn-instant-total')?.addEventListener('click', handleInstantTotal);
    $('btn-instant-curr')?.addEventListener('click', handleInstantCurr);

    // 回放
    $('btn-playback-start')?.addEventListener('click', () => handlePlayback(false));
    $('btn-reverse-start')?.addEventListener('click', () => handlePlayback(true));
    $('btn-stop-playback')?.addEventListener('click', handleStop);
    $('btn-pause')?.addEventListener('click', handlePause);
    $('btn-resume')?.addEventListener('click', () => handleResume(true));
    $('btn-resume-reverse')?.addEventListener('click', () => handleResume(false));
    $('btn-frame-forward')?.addEventListener('click', handleFrameForward);
    $('btn-frame-back')?.addEventListener('click', handleFrameBack);
    $('btn-change-mode')?.addEventListener('click', handleChangeMode);
    $('btn-fast')?.addEventListener('click', handleFast);
    $('btn-slow')?.addEventListener('click', handleSlow);
    $('btn-speed')?.addEventListener('click', handleSpeed);
    $('btn-seek')?.addEventListener('click', handleSeek);

    // 对讲
    $('btn-talk-start')?.addEventListener('click', handleTalkStart);
    $('btn-talk-stop')?.addEventListener('click', handleTalkStop);
    $('btn-record-talk')?.addEventListener('click', handleRecordTalk);
    $('btn-stop-record-talk')?.addEventListener('click', handleStopRecordTalk);

    // 声音 & 音量
    $('btn-open-sound')?.addEventListener('click', handleOpenSound);
    $('btn-close-sound')?.addEventListener('click', handleCloseSound);
    $('volume-slider')?.addEventListener('input', (e) => handleVolumeChange(e.target.value));

    // 录像 & 截图
    $('btn-capture')?.addEventListener('click', handleCapture);
    $('btn-record-mp4')?.addEventListener('click', () => handleRecordStart('MP4'));
    $('btn-record-ps')?.addEventListener('click', () => handleRecordStart('PS'));
    $('btn-record-stop')?.addEventListener('click', handleRecordStop);

    // 电子放大
    $('btn-zoom-enable')?.addEventListener('click', handleZoomEnable);
    $('btn-zoom-disable')?.addEventListener('click', handleZoomDisable);

    // 视频信息
    $('btn-get-video-info')?.addEventListener('click', () => {
      fetchVideoInfo();
      log('已刷新视频信息', 'info');
    });

    // 旋转 & 缩放
    $('rotate-select')?.addEventListener('change', handleRotate);
    $('scale-select')?.addEventListener('change', handleScale);
    $('btn-scale-cancel')?.addEventListener('click', handleScaleCancel);

    // 智能信息
    $('btn-intellect-open')?.addEventListener('click', () => handleIntellect(true));
    $('btn-intellect-close')?.addEventListener('click', () => handleIntellect(false));

    // 缩略图
    $('btn-thumbnails-open')?.addEventListener('click', handleThumbnailsOpen);
    $('btn-thumbnails-get')?.addEventListener('click', handleThumbnailsGet);
    $('btn-thumbnails-close')?.addEventListener('click', handleThumbnailsClose);

    // 水印
    $('btn-watermark-set')?.addEventListener('click', handleWatermarkSet);
    $('btn-watermark-cancel')?.addEventListener('click', handleWatermarkCancel);

    // 日志清空
    $('btn-clear-log')?.addEventListener('click', () => { $('log-container').innerHTML = ''; });
  }

  // ===== 入口 =====
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    createPlayer();
    log('播放器已初始化', 'info');
  });

})();
