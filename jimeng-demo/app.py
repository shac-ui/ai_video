"""
即梦AI Demo 后端
- 图片生成：4.0 (jimeng_t2i_v40) / 4.6 (jimeng_t2i_v46)
- 视频生成：3.0 Pro / 3.0 720P / 3.0 1080P
  文生视频、图生视频（首帧/首尾帧/运镇）
"""

import json
import os
import ssl

# 火山引擎 visual API 自签名证书，全局禁用 SSL 验证
ssl._create_default_https_context = ssl._create_unverified_context

from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
from volcengine.visual.VisualService import VisualService

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='/static')

# ===== 图片生成 req_key =====
IMAGE_REQ_KEY = {
    '4.0': 'jimeng_t2i_v40',
    '4.6': 'jimeng_t2i_v46',
}

# ===== 视频生成 req_key =====
# 格式: VIDEO_REQ_KEY[model][mode]
# model: 'pro' | '720p' | '1080p'
# mode:  't2v'(文生视频) | 'i2v_first'(首帧) | 'i2v_tail'(首尾帧) | 'i2v_camera'(运镜，仅720p)
VIDEO_REQ_KEY = {
    'pro': {
        't2v':       'jimeng_ti2v_v30_pro',
        'i2v_first': 'jimeng_ti2v_v30_pro',   # Pro 图生视频与文生共用同一 req_key
        'i2v_tail':  'jimeng_ti2v_v30_pro',
    },
    '720p': {
        't2v':        'jimeng_t2v_v30',
        'i2v_first':  'jimeng_i2v_first_v30',
        'i2v_tail':   'jimeng_i2v_first_tail_v30',
        'i2v_camera': 'jimeng_i2v_recamera_v30',
    },
    '1080p': {
        't2v':       'jimeng_t2v_v30_1080p',
        'i2v_first': 'jimeng_i2v_first_v30_1080',
        'i2v_tail':  'jimeng_i2v_first_tail_v30_1080',
    },
}

# ===== SDK 实例 =====
_svc = VisualService()
_svc.set_ak(os.getenv('VOLC_ACCESS_KEY', ''))
_svc.set_sk(os.getenv('VOLC_SECRET_KEY', ''))


def get_svc() -> VisualService:
    ak = os.getenv('VOLC_ACCESS_KEY', '')
    sk = os.getenv('VOLC_SECRET_KEY', '')
    if not ak or not sk:
        raise ValueError('未配置 VOLC_ACCESS_KEY / VOLC_SECRET_KEY，请在 .env 文件中填写')
    _svc.set_ak(ak)
    _svc.set_sk(sk)
    return _svc


def parse_result(raw) -> dict:
    """SDK 有时返回字符串，统一转为 dict"""
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


# ===== 路由 =====

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


# ---------- 图片生成 ----------

@app.route('/api/generate', methods=['POST'])
def generate_image():
    data = request.get_json(force=True)
    version = data.get('version', '4.0')
    req_key = IMAGE_REQ_KEY.get(version, IMAGE_REQ_KEY['4.0'])

    prompt = data.get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': '请输入提示词'}), 400

    form = {'req_key': req_key, 'prompt': prompt}

    size = data.get('size', '2048x2048')
    if 'x' in size:
        w, h = size.split('x')
        form['width'] = int(w)
        form['height'] = int(h)

    form['seed'] = int(data.get('seed', -1))
    form['scale'] = float(data.get('scale', 0.5))

    image_urls = [u for u in data.get('image_urls', []) if u and u.strip()]
    if image_urls:
        form['image_urls'] = image_urls

    form['force_single'] = bool(data.get('force_single', False))

    try:
        result = parse_result(get_svc().cv_sync2async_submit_task(form))
        code = result.get('code')
        if code not in (10000, '10000'):
            return jsonify({'error': result.get('message', '提交失败'), 'detail': result}), 500
        task_id = result.get('data', {}).get('task_id')
        if not task_id:
            return jsonify({'error': '无法获取 task_id', 'detail': result}), 500
        return jsonify({'task_id': task_id, 'req_key': req_key})
    except ValueError as e:
        return jsonify({'error': str(e), 'hint': '请在 .env 中配置 AK/SK'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/query', methods=['POST'])
def query_image():
    data = request.get_json(force=True)
    task_id = data.get('task_id', '')
    req_key = data.get('req_key', IMAGE_REQ_KEY['4.0'])
    if not task_id:
        return jsonify({'error': '缺少 task_id'}), 400

    try:
        result = parse_result(get_svc().cv_sync2async_get_result({
            'req_key': req_key,
            'task_id': task_id,
        }))
        code = result.get('code')
        if code in (10000, '10000'):
            resp_data = result.get('data', {})
            status = resp_data.get('status', '')
            if status in ('running', 'pending', 'in_queue'):
                return jsonify({'status': 'pending'})
            images = []
            for url in (resp_data.get('image_urls') or []):
                if url:
                    images.append({'type': 'url', 'data': url})
            for b64 in (resp_data.get('binary_data_base64') or []):
                if b64:
                    images.append({'type': 'base64', 'data': b64})
            if not images and status not in ('done', 'succeed', ''):
                return jsonify({'status': 'pending'})
            return jsonify({'status': 'done', 'images': images})
        elif code in (20000, '20000'):
            return jsonify({'status': 'pending'})
        else:
            return jsonify({'error': result.get('message', '查询失败'), 'code': code}), 500
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------- 视频生成 ----------

@app.route('/api/video/generate', methods=['POST'])
def generate_video():
    """
    提交视频生成任务
    Body 参数：
      model:       'pro' | '720p' | '1080p'
      mode:        't2v' | 'i2v_first' | 'i2v_tail' | 'i2v_camera'
      prompt:      提示词（必填）
      frames:      121 (5s) | 241 (10s)，默认 121
      aspect_ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9'
      seed:        -1 随机
      image_urls:  参考图 URL 列表（图生视频时传入，首帧传1张，首尾帧传2张）
    """
    data = request.get_json(force=True)
    model = data.get('model', 'pro')       # pro / 720p / 1080p
    mode = data.get('mode', 't2v')         # t2v / i2v_first / i2v_tail / i2v_camera

    # 校验 model/mode 组合
    model_map = VIDEO_REQ_KEY.get(model)
    if not model_map:
        return jsonify({'error': f'不支持的 model: {model}，可选 pro/720p/1080p'}), 400
    req_key = model_map.get(mode)
    if not req_key:
        return jsonify({'error': f'model={model} 不支持 mode={mode}'}), 400

    prompt = data.get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': '请输入提示词'}), 400

    form = {
        'req_key': req_key,
        'prompt': prompt,
        'seed': int(data.get('seed', -1)),
        'frames': int(data.get('frames', 121)),
        'aspect_ratio': data.get('aspect_ratio', '16:9'),
    }

    # 图生视频：传入参考图
    image_urls = [u for u in data.get('image_urls', []) if u and u.strip()]
    if image_urls:
        form['image_urls'] = image_urls

    # base64 图片（可选）
    b64_list = [b for b in data.get('binary_data_base64', []) if b and b.strip()]
    if b64_list:
        form['binary_data_base64'] = b64_list

    try:
        result = parse_result(get_svc().cv_sync2async_submit_task(form))
        code = result.get('code')
        if code not in (10000, '10000'):
            return jsonify({'error': result.get('message', '提交失败'), 'detail': result}), 500
        task_id = result.get('data', {}).get('task_id')
        if not task_id:
            return jsonify({'error': '无法获取 task_id', 'detail': result}), 500
        return jsonify({'task_id': task_id, 'req_key': req_key, 'model': model, 'mode': mode})
    except ValueError as e:
        return jsonify({'error': str(e), 'hint': '请在 .env 中配置 AK/SK'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/video/query', methods=['POST'])
def query_video():
    """
    查询视频任务结果
    Body: { task_id, req_key }
    返回: { status: 'pending'|'done'|'failed', video_url }
    """
    data = request.get_json(force=True)
    task_id = data.get('task_id', '')
    req_key = data.get('req_key', VIDEO_REQ_KEY['pro']['t2v'])
    if not task_id:
        return jsonify({'error': '缺少 task_id'}), 400

    try:
        result = parse_result(get_svc().cv_sync2async_get_result({
            'req_key': req_key,
            'task_id': task_id,
        }))
        code = result.get('code')

        if code in (10000, '10000'):
            resp_data = result.get('data', {})
            status = str(resp_data.get('status', '')).lower()

            # 仍在处理中
            if status in ('running', 'in_queue', 'pending', 'processing'):
                return jsonify({'status': 'pending'})

            # 兼容多种字段名
            video_url = (
                resp_data.get('video_url')
                or resp_data.get('resp_data')   # 部分版本返回在此字段
                or ''
            )

            # resp_data 有时是 JSON 字符串
            if not video_url and isinstance(resp_data.get('resp_data'), str):
                try:
                    inner = json.loads(resp_data['resp_data'])
                    video_url = inner.get('video_url', '')
                except Exception:
                    pass

            if video_url:
                return jsonify({'status': 'done', 'video_url': video_url})
            elif status in ('done', 'succeed', 'completed', ''):
                # 状态完成但 URL 为空（偶发情况，继续轮询）
                return jsonify({'status': 'pending'})
            else:
                return jsonify({'status': 'failed', 'detail': resp_data})

        elif code in (20000, '20000'):
            return jsonify({'status': 'pending'})
        else:
            return jsonify({
                'error': result.get('message', '查询失败'),
                'code': code,
                'status': 'failed',
            }), 500
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------- 配置 ----------

@app.route('/api/config', methods=['GET'])
def config():
    return jsonify({
        'ak_configured': bool(os.getenv('VOLC_ACCESS_KEY')),
        'sk_configured': bool(os.getenv('VOLC_SECRET_KEY')),
        'image_models': {
            '4.0': IMAGE_REQ_KEY['4.0'],
            '4.6': IMAGE_REQ_KEY['4.6'],
        },
        'video_models': {
            'pro':   {'label': '3.0 Pro (1080P)', 'modes': list(VIDEO_REQ_KEY['pro'].keys())},
            '720p':  {'label': '3.0 720P',         'modes': list(VIDEO_REQ_KEY['720p'].keys())},
            '1080p': {'label': '3.0 1080P',         'modes': list(VIDEO_REQ_KEY['1080p'].keys())},
        },
    })


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
