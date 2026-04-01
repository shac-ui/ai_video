"""
即梦AI 图片生成 Demo 后端
支持 4.0 (jimeng_t2i_v40) 和 4.6 (jimeng_t2i_v46) 版本
使用火山引擎官方 volcengine SDK，避免手写签名错误
"""

import json
import os
import ssl

# 火山引擎 visual API 使用自签名证书链，全局禁用 SSL 验证
ssl._create_default_https_context = ssl._create_unverified_context

from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv
from volcengine.visual.VisualService import VisualService

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='/static')

# ===== 配置 =====
VOLC_AK = os.getenv('VOLC_ACCESS_KEY', '')
VOLC_SK = os.getenv('VOLC_SECRET_KEY', '')

REQ_KEY_MAP = {
    '4.0': 'jimeng_t2i_v40',
    '4.6': 'jimeng_t2i_v46',
}

# 初始化官方 SDK 服务对象
_visual_service = VisualService()
_visual_service.set_ak(VOLC_AK)
_visual_service.set_sk(VOLC_SK)


def get_service() -> VisualService:
    """每次调用前刷新 AK/SK（支持运行时热更新环境变量）"""
    ak = os.getenv('VOLC_ACCESS_KEY', '')
    sk = os.getenv('VOLC_SECRET_KEY', '')
    if not ak or not sk:
        raise ValueError('未配置 VOLC_ACCESS_KEY / VOLC_SECRET_KEY，请在 .env 文件中填写')
    _visual_service.set_ak(ak)
    _visual_service.set_sk(sk)
    return _visual_service


# ===== 业务接口 =====

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/api/generate', methods=['POST'])
def generate():
    """提交图片生成任务（异步）"""
    data = request.get_json(force=True)
    version = data.get('version', '4.0')
    req_key = REQ_KEY_MAP.get(version, REQ_KEY_MAP['4.0'])

    prompt = data.get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': '请输入提示词'}), 400

    form = {
        'req_key': req_key,
        'prompt': prompt,
    }

    # 尺寸
    size = data.get('size', '2048x2048')
    if 'x' in size:
        w, h = size.split('x')
        form['width'] = int(w)
        form['height'] = int(h)

    # 随机种子
    form['seed'] = int(data.get('seed', -1))

    # 文本影响强度
    form['scale'] = float(data.get('scale', 0.5))

    # 参考图（图生图）
    image_urls = [u for u in data.get('image_urls', []) if u and u.strip()]
    if image_urls:
        form['image_urls'] = image_urls

    # 强制单图
    form['force_single'] = bool(data.get('force_single', False))

    try:
        svc = get_service()
        result = svc.cv_sync2async_submit_task(form)

        # SDK 返回的是 dict
        if isinstance(result, str):
            result = json.loads(result)

        code = result.get('code', result.get('Code'))
        if code not in (10000, '10000', None):
            return jsonify({'error': result.get('message', result.get('Message', '提交失败')), 'detail': result}), 500

        # 兼容两种响应结构
        task_id = (
            result.get('data', {}).get('task_id')
            or result.get('ResponseMetadata', {}).get('RequestId')
        )
        if not task_id:
            return jsonify({'error': '无法获取 task_id', 'detail': result}), 500

        return jsonify({'task_id': task_id, 'req_key': req_key})

    except ValueError as e:
        return jsonify({'error': str(e), 'hint': '请在 .env 文件中配置 VOLC_ACCESS_KEY 和 VOLC_SECRET_KEY'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/query', methods=['POST'])
def query():
    """查询任务结果"""
    data = request.get_json(force=True)
    task_id = data.get('task_id', '')
    req_key = data.get('req_key', REQ_KEY_MAP['4.0'])

    if not task_id:
        return jsonify({'error': '缺少 task_id'}), 400

    form = {
        'req_key': req_key,
        'task_id': task_id,
    }

    try:
        svc = get_service()
        result = svc.cv_sync2async_get_result(form)

        if isinstance(result, str):
            result = json.loads(result)

        code = result.get('code', result.get('Code'))
        if code in (10000, '10000', None):
            resp_data = result.get('data', {})
            status = resp_data.get('status', '')

            # 任务仍在处理中
            if status in ('running', 'pending', 'in_queue'):
                return jsonify({'status': 'pending'})

            # 完成（status 为 done/succeed 或空字符串均视为完成）
            images = []
            urls = resp_data.get('image_urls') or []
            b64_list = resp_data.get('binary_data_base64') or []
            for url in urls:
                if url:
                    images.append({'type': 'url', 'data': url})
            for b64 in b64_list:
                if b64:
                    images.append({'type': 'base64', 'data': b64})

            if not images and status not in ('done', 'succeed', ''):
                return jsonify({'status': 'pending'})

            return jsonify({'status': 'done', 'images': images})

        elif code in (20000, '20000'):
            return jsonify({'status': 'pending'})
        else:
            return jsonify({
                'error': result.get('message', result.get('Message', '查询失败')),
                'code': code,
            }), 500

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/config', methods=['GET'])
def config():
    ak = os.getenv('VOLC_ACCESS_KEY', '')
    sk = os.getenv('VOLC_SECRET_KEY', '')
    return jsonify({
        'ak_configured': bool(ak),
        'sk_configured': bool(sk),
        'models': {
            '4.0': {'req_key': REQ_KEY_MAP['4.0'], 'desc': '即梦图片生成 4.0'},
            '4.6': {'req_key': REQ_KEY_MAP['4.6'], 'desc': '即梦图片生成 4.6'},
        },
    })


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
