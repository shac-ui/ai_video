"""
即梦AI 图片生成 Demo 后端
支持 4.0 (jimeng_t2i_v40) 和 4.6 (jimeng_t2i_v46) 版本
使用火山引擎 AK/SK 签名认证 + 异步任务轮询
"""

import hashlib
import hmac
import json
import os
import time
import datetime
import urllib.request
import urllib.error
import urllib.parse
import base64
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='/static')

# ===== 火山引擎配置 =====
VOLC_AK = os.getenv('VOLC_ACCESS_KEY', '')
VOLC_SK = os.getenv('VOLC_SECRET_KEY', '')
VOLC_ENDPOINT = 'visual.volcengineapi.com'
VOLC_REGION = 'cn-north-1'
VOLC_SERVICE = 'cv'

# req_key 对应不同版本
REQ_KEY_MAP = {
    '4.0': 'jimeng_t2i_v40',
    '4.6': 'jimeng_t2i_v46',
}

# ===== 火山引擎 V4 签名实现 =====

def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()


def _get_signing_key(secret_key: str, date: str, region: str, service: str) -> bytes:
    k_date = _sign(('HMAC-SHA256' + secret_key).encode('utf-8'), date)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, service)
    k_signing = _sign(k_service, 'request')
    return k_signing


def _sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def build_signed_request(action: str, body_dict: dict) -> tuple[str, dict]:
    """构建带签名的请求，返回 (url, headers)"""
    if not VOLC_AK or not VOLC_SK:
        raise ValueError('未配置 VOLC_ACCESS_KEY / VOLC_SECRET_KEY，请在 .env 文件中填写')

    now = datetime.datetime.utcnow()
    date_str = now.strftime('%Y%m%d')
    time_str = now.strftime('%Y%m%dT%H%M%SZ')

    query_str = f'Action={action}&Version=2022-08-31'
    body = json.dumps(body_dict, ensure_ascii=False)
    payload_hash = _sha256_hex(body)

    # 规范化 Headers
    canonical_headers = (
        f'content-type:application/json\n'
        f'host:{VOLC_ENDPOINT}\n'
        f'x-content-sha256:{payload_hash}\n'
        f'x-date:{time_str}\n'
    )
    signed_headers = 'content-type;host;x-content-sha256;x-date'

    # 规范化请求
    canonical_request = '\n'.join([
        'POST',
        '/',
        query_str,
        canonical_headers,
        signed_headers,
        payload_hash,
    ])

    # 待签字符串
    credential_scope = f'{date_str}/{VOLC_REGION}/{VOLC_SERVICE}/request'
    string_to_sign = '\n'.join([
        'HMAC-SHA256',
        time_str,
        credential_scope,
        hashlib.sha256(canonical_request.encode('utf-8')).hexdigest(),
    ])

    # 计算签名
    signing_key = _get_signing_key(VOLC_SK, date_str, VOLC_REGION, VOLC_SERVICE)
    signature = hmac.new(signing_key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

    authorization = (
        f'HMAC-SHA256 Credential={VOLC_AK}/{credential_scope}, '
        f'SignedHeaders={signed_headers}, '
        f'Signature={signature}'
    )

    headers = {
        'Authorization': authorization,
        'Content-Type': 'application/json',
        'Host': VOLC_ENDPOINT,
        'X-Content-Sha256': payload_hash,
        'X-Date': time_str,
    }

    url = f'https://{VOLC_ENDPOINT}/?{query_str}'
    return url, headers, body


def call_volc_api(action: str, body_dict: dict) -> dict:
    """调用火山引擎 API，返回解析后的 JSON"""
    url, headers, body = build_signed_request(action, body_dict)
    req = urllib.request.Request(
        url,
        data=body.encode('utf-8'),
        headers=headers,
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise RuntimeError(f'HTTP {e.code}: {error_body}')


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

    body = {
        'req_key': req_key,
        'prompt': prompt,
    }

    # 尺寸
    size = data.get('size', '2048x2048')
    if 'x' in size:
        w, h = size.split('x')
        body['width'] = int(w)
        body['height'] = int(h)

    # 随机种子
    seed = data.get('seed', -1)
    body['seed'] = int(seed)

    # 文本影响强度
    scale = data.get('scale', 0.5)
    body['scale'] = float(scale)

    # 参考图（图生图）
    image_urls = data.get('image_urls', [])
    if image_urls:
        body['image_urls'] = [u for u in image_urls if u.strip()]

    # 多图参考输出数控制
    force_single = data.get('force_single', False)
    body['force_single'] = bool(force_single)

    try:
        result = call_volc_api('CVSync2AsyncSubmitTask', body)
        if result.get('code') != 10000:
            return jsonify({'error': result.get('message', '提交失败'), 'detail': result}), 500
        task_id = result['data']['task_id']
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

    body = {
        'req_key': req_key,
        'task_id': task_id,
    }

    try:
        result = call_volc_api('CVSync2AsyncGetResult', body)
        code = result.get('code')
        if code == 10000:
            resp_data = result.get('data', {})
            status = resp_data.get('status', '')
            # 已完成
            if status in ('done', 'succeed', ''):
                images = []
                # 优先 image_urls，其次 binary_data_base64
                urls = resp_data.get('image_urls') or []
                b64_list = resp_data.get('binary_data_base64') or []
                for url in urls:
                    if url:
                        images.append({'type': 'url', 'data': url})
                for b64 in b64_list:
                    if b64:
                        images.append({'type': 'base64', 'data': b64})
                return jsonify({'status': 'done', 'images': images})
            else:
                return jsonify({'status': 'pending'})
        elif code == 20000:
            # 任务排队中
            return jsonify({'status': 'pending'})
        else:
            return jsonify({'error': result.get('message', '查询失败'), 'code': code}), 500
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/config', methods=['GET'])
def config():
    """返回当前配置状态（不暴露密钥）"""
    return jsonify({
        'ak_configured': bool(VOLC_AK),
        'sk_configured': bool(VOLC_SK),
        'models': {
            '4.0': {'req_key': REQ_KEY_MAP['4.0'], 'desc': '即梦图片生成 4.0'},
            '4.6': {'req_key': REQ_KEY_MAP['4.6'], 'desc': '即梦图片生成 4.6'},
        },
    })


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
