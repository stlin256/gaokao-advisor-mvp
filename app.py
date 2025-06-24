import os
import json
import traceback
from datetime import datetime, timezone, timedelta
from flask import Flask, request, jsonify, send_from_directory, Response
from openai import OpenAI
from dotenv import load_dotenv
import threading

load_dotenv() # Load environment variables from .env file

# --- Configuration ---
DAILY_LIMIT = int(os.environ.get("DAILY_LIMIT", 100))
USAGE_FILE = os.path.join('_data', 'usage.json')
usage_data = {}
file_lock = threading.Lock()

# --- File-based Usage Counter ---
def get_beijing_today_str():
    """Gets the current date string in Beijing Time (UTC+8)."""
    beijing_tz = timezone(timedelta(hours=8))
    return datetime.now(beijing_tz).strftime('%Y-%m-%d')

def load_or_initialize_usage():
    """Loads usage data from file, or initializes if not present/outdated."""
    global usage_data
    with file_lock:
        today_str = get_beijing_today_str()
        try:
            if os.path.exists(USAGE_FILE):
                with open(USAGE_FILE, 'r') as f:
                    data = json.load(f)
                # If the date in file is not today, reset
                if today_str not in data:
                    usage_data = {today_str: 0}
                else:
                    usage_data = data
            else:
                # If file doesn't exist, create it
                usage_data = {today_str: 0}
                _write_usage_file()
        except (json.JSONDecodeError, FileNotFoundError):
            # If file is corrupted or not found, start fresh
            usage_data = {today_str: 0}
            _write_usage_file()
    print(f"Usage initialized for {today_str}: {usage_data.get(today_str, 0)} requests.")

def get_current_usage():
    """Gets the current usage count for today."""
    today_str = get_beijing_today_str()
    # Check if date has changed since last load
    if today_str not in usage_data:
        load_or_initialize_usage()
    return usage_data.get(today_str, 0)

def increment_usage():
    """Increments usage count and writes to file."""
    global usage_data
    with file_lock:
        today_str = get_beijing_today_str()
        # Ensure we are on the correct day
        if today_str not in usage_data:
            usage_data = {today_str: 1}
        else:
            usage_data[today_str] = usage_data.get(today_str, 0) + 1
        _write_usage_file()
        return usage_data[today_str]

def _write_usage_file():
    """Writes the current usage_data to the file (internal, needs lock)."""
    # Ensure the _data directory exists
    os.makedirs(os.path.dirname(USAGE_FILE), exist_ok=True)
    with open(USAGE_FILE, 'w') as f:
        json.dump(usage_data, f, indent=2)

app = Flask(__name__, static_url_path='', static_folder='.')

def prepare_prompt(user_data, enrollment_data=None):
    user_info = user_data.get('rawText', '')
    province = user_data.get('province', '未知')
    rank = user_data.get('rank', '未知')

    # Base prompt structure
    prompt_parts = [
        "你是一位顶级的、资深的、充满智慧的高考志愿填报专家。你的任务是为一位正在纠结中的高三学生或家长，提供一份专业、客观、有深度、有温度的志愿对比分析报告。",
        "**重要指令**: 在你输出最终的分析报告之前，请务必先进行一步深度思考。将你的思考过程、分析逻辑、以及数据检索的步骤，完整地包含在 `<think>` 和 `</think>` 标签之间。这部分内容是给专业用户看的，可以帮助他们理解你的决策过程。思考结束后，再输出面向用户的、完整的Markdown格式报告。",
        "**学生背景:**",
        f"- 省份: {province}",
        f"- 分数/位次: {rank}",
        "- 他的原始笔记和困惑如下:",
        "---",
        user_info,
        "---"
    ]

    # Conditionally add enrollment data section
    if enrollment_data and enrollment_data.get('data'):
        enrollment_info = json.dumps(enrollment_data.get('data', {}), ensure_ascii=False, indent=2)
        prompt_parts.extend([
            "**参考数据 (2025年最新招生计划变动，你需要结合这份数据进行分析):**",
            "---",
            enrollment_info,
            "---"
        ])

    # Add the rest of the prompt
    prompt_parts.extend([
        "**你的任务和要求:**",
        "1.  **深度思考(在`<think>`标签内)**:",
        "    *   第一步: 识别用户的核心问题和纠结的点。",
        "    *   第二步: 检索并列出与用户方案相关的招生计划变动数据。" if enrollment_data else "    *   第二步: 基于你的知识库进行分析。",
        "    *   第三步: 设定评估维度，并简述每个维度的评估逻辑。",
        "2.  **正式报告(在`<think>`标签外)**:",
        "    *   **创建方案PK记分卡:** 这是报告的核心！请创建一个Markdown表格，从以下维度对核心方案进行对比打分（满分5星，用 ★★★☆☆ 表示）：录取概率、学校实力/声誉、专业前景/钱景、城市发展/生活品质、个人兴趣/困惑匹配度。",
        "    *   **详细文字解读:** 针对记分卡中的每一项，展开详细的、有理有据的文字分析。",
        "    *   **“对话式”分析与建议:** 模拟与学生面对面对话的口吻，设身处地地理解他的困惑。",
        "    *   **最终结论总结:** 给出一个清晰的、总结性的结论。",
        "**输出格式要求:**",
        "- **必须**先输出`<think>`标签包裹的思考内容，然后再输出正式报告。",
        "- 正式报告**必须**是完整的Markdown格式。",
        "- 正式报告**必须**包含“方案PK记- 记分卡”表格。"
    ])
    
    return "\n\n".join(prompt_parts)

# --- Static File Routes ---
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/_data/<path:path>')
def serve_data_files(path):
    return send_from_directory('_data', path)

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# --- API Routes ---
@app.route('/api/usage', methods=['GET'])
def get_usage():
    try:
        current_usage = get_current_usage()
        return jsonify({"used": current_usage, "limit": DAILY_LIMIT})
    except Exception as e:
        return jsonify({"used": "N/A", "limit": "N/A", "error": str(e)}), 500

@app.route('/api/handler', methods=['POST'])
def handler():
    # --- Cost Control & Safety Check ---
    try:
        current_usage = get_current_usage()
        if current_usage >= DAILY_LIMIT:
            error_msg = {"error": f"非常抱歉，今日的免费体验名额（{DAILY_LIMIT}次）已被抢完！请您明日再来。"}
            return jsonify({**error_msg, "usage": {"used": current_usage, "limit": DAILY_LIMIT}}), 429
    except Exception as e:
        print(f"Error during usage check: {e}")
        # Allow to proceed if usage check fails, but log it.
        pass
    
    # --- Main Logic ---
    try:
        body = request.get_json(silent=True)
        if not body or 'userInput' not in body:
            return jsonify({"error": "请求格式错误或缺少'userInput'字段。"}), 400
        user_data = body.get('userInput', {})

        enrollment_data = None
        load_data = os.environ.get("LOAD_ENROLLMENT_DATA", "false").lower() == "true"

        if load_data:
            try:
                enrollment_data_path = os.path.join('_data', 'enrollment_data_2025.json')
                with open(enrollment_data_path, 'r', encoding='utf-8') as f:
                    enrollment_data = json.load(f)
            except FileNotFoundError:
                # If the file is not found but loading is requested, we can choose to ignore or log it.
                # For now, we'll just proceed without the data.
                print("Warning: LOAD_ENROLLMENT_DATA is true, but enrollment_data_2025.json was not found.")
        
        prompt = prepare_prompt(user_data, enrollment_data)

    except FileNotFoundError:
        return jsonify({"error": "服务器内部错误：关键数据文件丢失。"}), 500
    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"UNHANDLED EXCEPTION IN HANDLER: {error_trace}")
        return jsonify({"error": f"服务器在准备请求时发生错误: {e}"}), 500

    def stream_response(p):
        try:
            new_usage = increment_usage()
            yield f"event: usage\ndata: {json.dumps({'used': new_usage, 'limit': DAILY_LIMIT})}\n\n"

            api_key = os.environ.get("OPENAI_API_KEY")
            base_url = os.environ.get("OPENAI_API_BASE")
            if not api_key or not base_url:
                error_message = {'error': '服务器环境变量 OPENAI_API_KEY 或 OPENAI_API_BASE 未配置。'}
                yield f"event: error\ndata: {json.dumps(error_message, ensure_ascii=False)}\n\n"
                return
            
            client = OpenAI(api_key=api_key, base_url=base_url)
            model_name = os.environ.get("OPENAI_MODEL_NAME", "qwen3-30b-a3b")
            
            stream = client.chat.completions.create(
                messages=[{"role": "user", "content": p}],
                model=model_name,
                stream=True
            )

            for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield f"event: message\ndata: {json.dumps(content)}\n\n"
            
            yield f"event: end\ndata: End of stream\n\n"

        except Exception as e:
            error_trace = traceback.format_exc()
            print(f"UNHANDLED EXCEPTION IN STREAM: {error_trace}")
            error_message = { "error": f"服务器在与AI通信时发生错误: {e}", "traceback": error_trace }
            yield f"event: error\ndata: {json.dumps(error_message, ensure_ascii=False)}\n\n"

    return Response(stream_response(prompt), mimetype='text/event-stream')

if __name__ == "__main__":
    load_or_initialize_usage()
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)