/**
 * H5Player 播放器 UI 控制器
 * 基于 JSPlugin (h5player v2.5.1) API 封装
 * 文档参考: H5player2.5.1_开发指南
 */

(function () {
  'use strict';

  // ===== 状态管理 =====
  const state = {
    plugin: null,
    curIndex: 0,
    mode: 'preview',       // 'preview' | 'playback'
    soundOpen: false,
    recording: false,
    zoomEnabled: false,
    isFullscreen: false,
    currentSplit: 1,
    currentSpeed: 1,
    currentRotation: 0,
    osdTimer: null,
  };

  // ===== DOM 引用 =====
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== 日志工具 =====
  function log(msg, type = 'default') {
    const container = $('log-container');
    if (!container) return;
    const now = new Date();
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${escapeHtml(msg)}</span>`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ===== Toast 通知 =====
  function toast(msg, type = 'info') {
    const container = $('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('hiding');
      setTimeout(() => el.remove(), 200);
    }, 3000);
  }

  // ===== 初始化 JSPlugin =====
  function initPlugin() {
    if (typeof JSPlugin === 'undefined') {
      log('警告: 未检测到 h5player.min.js，运行演示模式', 'warning');
      toast('未加载 h5player.min.js，进入演示模式', 'warning');
      initDemoMode();
      return;
    }

    try {
      state.plugin = new JSPlugin({
        szId: 'play_window',
        szBasePath: './dist',
        mseWorkerEnable: false,
        bSupporDoubleClickFull: true,
        iMaxSplit: 4,
        iCurrentSplit: 1,
      });

      state.plugin.JS_SetWindowControlCallback({
        windowEventSelect: function (index) {
          state.curIndex = index;
          log(`切换窗口: ${index}`, 'info');
        },
        pluginErrorHandler: function (index, iErrorCode, oError) {
          const msg = `窗口[${index}] 错误 0x${iErrorCode.toString(16).toUpperCase()}: ${oError?.info || '未知错误'}`;
          log(msg, 'error');
          toast(msg, 'error');
        },
        windowEventOver: function (index) {},
        windowEventOut: function (index) {},
        windowEventUp: function (index) {},
        windowFullCcreenChange: function (bFull) {
          state.isFullscreen = bFull;
          log(`全屏状态: ${bFull ? '开启' : '关闭'}`, 'info');
        },
        firstFrameDisplay: function (index, iWidth, iHeight) {
          log(`窗口[${index}] 首帧显示: ${iWidth}x${iHeight}`, 'success');
          refreshVideoInfo();
          startOSDPolling();
        },
        performanceLack: function () {
          log('警告: 性能不足，可能影响播放质量', 'warning');
          toast('性能不足，建议关闭其他程序', 'warning');
        },
        StreamEnd: function (index) {
          log(`窗口[${index}] 回放结束`, 'info');
          toast(`窗口[${index}] 回放结束`, 'info');
        },
        InterruptStream: function (iWndIndex, interruptTime) {
          log(`窗口[${iWndIndex}] 断流: ${interruptTime}s`, 'warning');
        },
        talkPluginErrorHandler: function (iErrorCode, oErrorInfo) {
          log(`对讲错误 0x${iErrorCode.toString(16).toUpperCase()}`, 'error');
        },
        ThumbnailsEvent: function (iWndIndex, eventType, eventCode) {
          log(`缩略图事件 窗口[${iWndIndex}] type:${eventType} code:${eventCode}`, 'info');
        },
      }).then(() => {
        log('JSPlugin 初始化成功', 'success');
        toast('播放器初始化成功', 'success');
      }).catch((err) => {
        log(`JSPlugin 初始化失败: ${err}`, 'error');
        toast('播放器初始化失败', 'error');
      });
    } catch (e) {
      log(`初始化异常: ${e.message}`, 'error');
    }
  }

  // ===== 演示模式（无实际播放器时展示UI）=====
  function initDemoMode() {
    const container = $('play_window');
    if (!container) return;
    container.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:#000;color:#64748b;';
    container.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="#2d4060" stroke-width="2"/>
        <polygon points="24,20 48,32 24,44" fill="#3b82f6" opacity="0.5"/>
      </svg>
      <div style="font-size:14px;color:#94a3b8">演示模式 · 请配置流媒体URL后播放</div>
      <div style="font-size:11px;color:#475569">需引入 h5player.min.js 以启用实际播放功能</div>
    `;
  }

  // ===== 播放控制 =====
  function handlePlay() {
    if (!state.plugin) { toast('播放器未就绪', 'warning'); return; }
    const url = $('stream-url').value.trim();
    if (!url) { toast('请输入视频流URL', 'warning'); return; }

    const mode = parseInt(document.querySelector('input[name="decode-mode"]:checked').value);
    const token = $('auth-token').value.trim();
    const config = {
      playURL: url,
      mode: mode,
    };
    if (token) config.token = token;

    let startTime, endTime;
    if (state.mode === 'playback') {
      startTime = $('start-time').value;
      endTime = $('end-time').value;
      if (!startTime || !endTime) { toast('请选择回放时间段', 'warning'); return; }
      config.PlayBackMode = parseInt(document.querySelector('input[name="playback-mode"]:checked').value);
      startTime = toISO(startTime);
      endTime = toISO(endTime);
    }

    log(`开始${state.mode === 'playback' ? '回放' : '预览'}: ${url}`, 'info');

    state.plugin.JS_Play(url, config, state.curIndex, startTime, endTime)
      .then(() => {
        log('播放成功', 'success');
        toast('播放成功', 'success');
      })
      .catch((err) => {
        log(`播放失败: ${JSON.stringify(err)}`, 'error');
        toast('播放失败，请检查URL和网络', 'error');
      });
  }

  function handleStop() {
    if (!state.plugin) return;
    state.plugin.JS_Stop(state.curIndex)
      .then(() => {
        log('停止播放成功', 'success');
        stopOSDPolling();
        resetVideoInfo();
      })
      .catch((err) => log(`停止失败: ${err}`, 'error'));
  }

  // ===== 音量控制 =====
  function handleOpenSound() {
    if (!state.plugin) return;
    state.plugin.JS_OpenSound(state.curIndex)
      .then(() => {
        state.soundOpen = true;
        updateSoundIcon();
        log('声音已开启', 'success');
      })
      .catch((err) => {
        log(`开启声音失败: 0x${err?.errorCode?.toString(16) || err}`, 'error');
        toast('开启声音失败，请等首帧显示后再试', 'error');
      });
  }

  function handleCloseSound() {
    if (!state.plugin) return;
    state.plugin.JS_CloseSound(state.curIndex)
      .then(() => {
        state.soundOpen = false;
        updateSoundIcon();
        log('声音已关闭', 'info');
      })
      .catch((err) => log(`关闭声音失败: ${err}`, 'error'));
  }

  function handleVolumeChange(value) {
    if (!state.plugin) return;
    $('volume-display').textContent = value;
    state.plugin.JS_SetVolume(state.curIndex, parseInt(value))
      .catch((err) => log(`设置音量失败: ${err}`, 'error'));
  }

  function updateSoundIcon() {
    $('icon-sound-on').style.display = state.soundOpen ? '' : 'none';
    $('icon-sound-off').style.display = state.soundOpen ? 'none' : '';
  }

  // ===== 录像 =====
  function handleRecordStart() {
    if (!state.plugin) return;
    const ts = formatTimestamp(new Date());
    const fileName = `record_${ts}.mp4`;
    state.plugin.JS_StartSaveEx(state.curIndex, fileName, 5)
      .then(() => {
        state.recording = true;
        $('btn-record-start').style.display = 'none';
        $('btn-record-stop').style.display = '';
        $('btn-record-stop').classList.add('recording');
        log(`开始录像: ${fileName}`, 'success');
        toast('录像已开始', 'success');
      })
      .catch((err) => {
        log(`开始录像失败: 0x${err?.errorCode?.toString(16) || err}`, 'error');
        toast('录像失败，请先播放视频', 'error');
      });
  }

  function handleRecordStop() {
    if (!state.plugin) return;
    state.plugin.JS_StopSave(state.curIndex)
      .then(() => {
        state.recording = false;
        $('btn-record-start').style.display = '';
        $('btn-record-stop').style.display = 'none';
        $('btn-record-stop').classList.remove('recording');
        log('录像已保存', 'success');
        toast('录像已保存到本地', 'success');
      })
      .catch((err) => log(`停止录像失败: ${err}`, 'error'));
  }

  // ===== 抓图 =====
  function handleCapture() {
    if (!state.plugin) return;
    const ts = formatTimestamp(new Date());
    const fileName = `capture_${ts}`;
    state.plugin.JS_CapturePicture(state.curIndex, fileName, 'JPEG')
      .then(() => {
        log(`截图已保存: ${fileName}.jpg`, 'success');
        toast('截图已保存到本地', 'success');
      })
      .catch((err) => {
        log(`截图失败: 0x${err?.errorCode?.toString(16) || err}`, 'error');
        toast('截图失败，请等视频播放后重试', 'error');
      });
  }

  // ===== 回放控制 =====
  function handlePause() {
    if (!state.plugin) return;
    state.plugin.JS_Pause(state.curIndex)
      .then(() => log('回放已暂停', 'info'))
      .catch((err) => log(`暂停失败: ${err}`, 'error'));
  }

  function handleResume() {
    if (!state.plugin) return;
    state.plugin.JS_Resume(state.curIndex)
      .then(() => log('回放已恢复', 'info'))
      .catch((err) => log(`恢复失败: ${err}`, 'error'));
  }

  function handleFrameForward() {
    if (!state.plugin) return;
    state.plugin.JS_FrameForward(state.curIndex)
      .then(() => log('单帧进', 'info'))
      .catch((err) => log(`单帧进失败: 0x${err?.errorCode?.toString(16) || err}`, 'error'));
  }

  function handleFrameBack() {
    if (!state.plugin) return;
    state.plugin.JS_FrameBack(state.curIndex)
      .then(() => log('单帧退', 'info'))
      .catch((err) => log(`单帧退失败: 0x${err?.errorCode?.toString(16) || err}`, 'error'));
  }

  function handleFast() {
    if (!state.plugin) return;
    state.plugin.JS_Fast(state.curIndex)
      .then((rate) => {
        log(`快放 x${rate}`, 'info');
        state.currentSpeed = rate;
        updateSpeedUI(rate);
      })
      .catch((err) => {
        if (err?.errorCode === 0x12f910021) toast('已达最大倍速', 'warning');
        else log(`快放失败: ${err}`, 'error');
      });
  }

  function handleSlow() {
    if (!state.plugin) return;
    state.plugin.JS_Slow(state.curIndex)
      .then((rate) => {
        log(`慢放 x${rate}`, 'info');
        state.currentSpeed = rate;
        updateSpeedUI(rate);
      })
      .catch((err) => {
        if (err?.errorCode === 0x12f910022) toast('已达最小倍速', 'warning');
        else log(`慢放失败: ${err}`, 'error');
      });
  }

  function handleSpeed(rate) {
    if (!state.plugin) return;
    state.plugin.JS_Speed(state.curIndex, rate)
      .then((actualRate) => {
        log(`速率设置: ${actualRate}x`, 'info');
        state.currentSpeed = actualRate;
        updateSpeedUI(actualRate);
      })
      .catch((err) => log(`速率设置失败: ${err}`, 'error'));
  }

  function handleChangeMode() {
    if (!state.plugin) return;
    state.plugin.JS_ChangeMode(state.curIndex)
      .then(() => log('正/倒放切换成功', 'info'))
      .catch((err) => log(`正/倒放切换失败: ${err}`, 'error'));
  }

  function updateSpeedUI(rate) {
    $$('.speed-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.rate) === rate);
    });
  }

  // ===== 电子放大 =====
  function handleZoomToggle() {
    if (!state.plugin) return;
    if (state.zoomEnabled) {
      state.plugin.JS_DisableZoom(state.curIndex)
        .then(() => {
          state.zoomEnabled = false;
          $('btn-zoom').classList.remove('active');
          log('电子放大已关闭', 'info');
        })
        .catch((err) => log(`关闭电子放大失败: ${err}`, 'error'));
    } else {
      state.plugin.JS_EnableZoom(state.curIndex)
        .then(() => {
          state.zoomEnabled = true;
          $('btn-zoom').classList.add('active');
          log('电子放大已开启', 'info');
        })
        .catch((err) => log(`开启电子放大失败: ${err}`, 'error'));
    }
  }

  // ===== 旋转 =====
  function handleRotate(degree) {
    if (!state.plugin) return;
    state.plugin.JS_Rotate(state.curIndex, degree)
      .then(() => {
        state.currentRotation = degree;
        $$('.rotate-btn').forEach(btn => {
          btn.classList.toggle('active', parseInt(btn.dataset.degree) === degree);
        });
        log(`旋转: ${degree}°`, 'info');
      })
      .catch((err) => log(`旋转失败: ${err}`, 'error'));
  }

  // ===== 缩放 =====
  function handleScale(ratio) {
    if (!state.plugin) return;
    state.plugin.JS_Scale(state.curIndex, ratio)
      .then(() => log(`缩放比例: ${ratio}`, 'info'))
      .catch((err) => log(`缩放失败: ${err}`, 'error'));
  }

  function handleScaleCancel() {
    if (!state.plugin) return;
    state.plugin.JS_ScaleCancel(state.curIndex)
      .then(() => {
        log('已还原画面', 'info');
        $('scale-ratio').value = 'fill';
        $$('.rotate-btn').forEach(btn => btn.classList.remove('active'));
        $$('.rotate-btn[data-degree="0"]').forEach(btn => btn.classList.add('active'));
      })
      .catch((err) => log(`还原失败: ${err}`, 'error'));
  }

  // ===== 分屏 =====
  function handleSplit(splitNum) {
    if (!state.plugin) return;
    state.plugin.JS_ArrangeWindow(splitNum)
      .then(() => {
        state.currentSplit = splitNum;
        $$('[data-split]').forEach(btn => {
          btn.classList.toggle('active', parseInt(btn.dataset.split) === splitNum);
        });
        log(`分屏: ${splitNum}x${splitNum}`, 'info');
      })
      .catch((err) => log(`分屏失败: ${err}`, 'error'));
  }

  // ===== 全屏 =====
  function handleFullscreen() {
    if (!state.plugin) return;
    const next = !state.isFullscreen;
    state.plugin.JS_FullScreenDisplay(next)
      .then(() => {
        state.isFullscreen = next;
        log(`全屏: ${next ? '开启' : '关闭'}`, 'info');
      })
      .catch((err) => log(`全屏失败: ${err}`, 'error'));
  }

  function handleFullscreenSingle() {
    if (!state.plugin) return;
    state.plugin.JS_FullScreenSingle(state.curIndex)
      .then(() => log(`窗口[${state.curIndex}] 单窗全屏`, 'info'))
      .catch((err) => log(`单窗全屏失败: ${err}`, 'error'));
  }

  // ===== 对讲 =====
  function handleStartTalk() {
    if (!state.plugin) return;
    const url = $('talk-url').value.trim();
    if (!url) { toast('请输入对讲URL', 'warning'); return; }
    const token = $('auth-token').value.trim();
    const param = token ? { token } : {};
    state.plugin.JS_StartTalk(url, param)
      .then(() => {
        log('对讲已开启', 'success');
        toast('对讲已开启', 'success');
        $('btn-start-talk').classList.add('active');
      })
      .catch((err) => {
        log(`开启对讲失败: 0x${err?.errorCode?.toString(16) || err}`, 'error');
        toast('对讲需在 HTTPS 环境下使用', 'error');
      });
  }

  function handleStopTalk() {
    if (!state.plugin) return;
    state.plugin.JS_StopTalk()
      .then(() => {
        log('对讲已停止', 'info');
        $('btn-start-talk').classList.remove('active');
      })
      .catch((err) => log(`停止对讲失败: ${err}`, 'error'));
  }

  function handleTalkVolume(value) {
    if (!state.plugin) return;
    $('talk-volume-display').textContent = value;
    state.plugin.JS_TalkSetVolume(parseInt(value))
      .catch((err) => log(`设置对讲音量失败: ${err}`, 'error'));
  }

  // ===== OSD 时间轮询 =====
  function startOSDPolling() {
    if (state.osdTimer) return;
    state.osdTimer = setInterval(() => {
      if (!state.plugin) return;
      state.plugin.JS_GetOSDTime(state.curIndex)
        .then((time) => {
          if (time) {
            const d = new Date(time);
            $('osd-time-display').textContent =
              `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          }
        })
        .catch(() => {});
    }, 1000);
  }

  function stopOSDPolling() {
    if (state.osdTimer) {
      clearInterval(state.osdTimer);
      state.osdTimer = null;
    }
    $('osd-time-display').textContent = '--:--:--';
  }

  // ===== 视频信息 =====
  function refreshVideoInfo() {
    if (!state.plugin) return;
    state.plugin.JS_GetVideoInfo(state.curIndex)
      .then((info) => {
        $('info-codec').textContent = info.VideType || '--';
        $('info-resolution').textContent = `${info.width}x${info.height}`;
        $('info-framerate').textContent = info.frameRate ? `${info.frameRate}fps` : '--';
        $('info-bitrate').textContent = info.bitRate ? `${info.bitRate}Kbps` : '--';
        $('info-audio').textContent = info.audioType || '--';
        $('info-format').textContent = info.systemFormt || '--';
        $('modal-video-info').innerHTML = `
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            ${Object.entries(info).map(([k,v]) => `
              <tr style="border-bottom:1px solid #2d4060">
                <td style="padding:6px 8px;color:#94a3b8;width:40%">${k}</td>
                <td style="padding:6px 8px;color:#e2e8f0;font-family:monospace">${v}</td>
              </tr>`).join('')}
          </table>
        `;
      })
      .catch(() => {});
  }

  function resetVideoInfo() {
    ['info-codec','info-resolution','info-framerate','info-bitrate','info-audio','info-format']
      .forEach(id => { $(id).textContent = '--'; });
  }

  // ===== 模式切换 =====
  function switchMode(mode) {
    state.mode = mode;
    $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    const isPlayback = mode === 'playback';
    $('playback-config').style.display = isPlayback ? '' : 'none';
    $('playback-controls').style.display = isPlayback ? '' : 'none';
  }

  // ===== 工具函数 =====
  function toISO(localStr) {
    if (!localStr) return undefined;
    return new Date(localStr).toISOString().replace('.000Z', 'Z');
  }

  function formatTimestamp(d) {
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // ===== 绑定事件 =====
  function bindEvents() {
    // 模式切换
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    // 播放/停止
    $('btn-play')?.addEventListener('click', handlePlay);
    $('btn-stop')?.addEventListener('click', handleStop);

    // 音量
    $('btn-open-sound')?.addEventListener('click', handleOpenSound);
    $('btn-close-sound')?.addEventListener('click', handleCloseSound);
    $('btn-mute')?.addEventListener('click', () => {
      state.soundOpen ? handleCloseSound() : handleOpenSound();
    });
    $('volume-slider')?.addEventListener('input', (e) => handleVolumeChange(e.target.value));

    // 录像
    $('btn-record-start')?.addEventListener('click', handleRecordStart);
    $('btn-record-stop')?.addEventListener('click', handleRecordStop);

    // 抓图
    $('btn-capture')?.addEventListener('click', handleCapture);

    // 回放控制
    $('btn-pause')?.addEventListener('click', handlePause);
    $('btn-resume')?.addEventListener('click', handleResume);
    $('btn-frame-forward')?.addEventListener('click', handleFrameForward);
    $('btn-frame-back')?.addEventListener('click', handleFrameBack);
    $('btn-fast')?.addEventListener('click', handleFast);
    $('btn-slow')?.addEventListener('click', handleSlow);
    $('btn-change-mode')?.addEventListener('click', handleChangeMode);

    // 速率按钮
    $$('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => handleSpeed(parseInt(btn.dataset.rate)));
    });

    // 旋转按钮
    $$('.rotate-btn').forEach(btn => {
      btn.addEventListener('click', () => handleRotate(parseInt(btn.dataset.degree)));
    });

    // 缩放
    $('scale-ratio')?.addEventListener('change', (e) => handleScale(e.target.value));
    $('btn-scale-cancel')?.addEventListener('click', handleScaleCancel);

    // 电子放大
    $('btn-zoom')?.addEventListener('click', handleZoomToggle);

    // 旋转（工具栏）
    $('btn-rotate')?.addEventListener('click', () => {
      const next = (state.currentRotation + 90) % 360;
      handleRotate(next);
    });

    // 分屏
    $$('[data-split]').forEach(btn => {
      btn.addEventListener('click', () => handleSplit(parseInt(btn.dataset.split)));
    });

    // 全屏
    $('btn-fullscreen')?.addEventListener('click', handleFullscreen);
    $('btn-fullscreen-single')?.addEventListener('click', handleFullscreenSingle);

    // 对讲
    $('btn-start-talk')?.addEventListener('click', handleStartTalk);
    $('btn-stop-talk')?.addEventListener('click', handleStopTalk);
    $('talk-volume-slider')?.addEventListener('input', (e) => handleTalkVolume(e.target.value));

    // 视频信息弹窗
    $('btn-video-info')?.addEventListener('click', () => {
      refreshVideoInfo();
      $('video-info-modal').style.display = 'flex';
    });
    $('close-video-modal')?.addEventListener('click', () => {
      $('video-info-modal').style.display = 'none';
    });
    $('video-info-modal')?.addEventListener('click', (e) => {
      if (e.target === $('video-info-modal')) $('video-info-modal').style.display = 'none';
    });

    // 清空日志
    $('btn-clear-log')?.addEventListener('click', () => {
      $('log-container').innerHTML = '';
    });

    // URL输入框回车播放
    $('stream-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handlePlay();
    });
  }

  // ===== 页面加载完成后初始化 =====
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initPlugin();
    log('播放器界面已加载', 'info');
  });

})();
