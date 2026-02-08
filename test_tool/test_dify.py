"""
Dify API 连通性测试工具
用于验证 Dify 对话 API 是否正常工作，并可模拟完整的角色卡创建流程。

使用方式:
  python test_dify.py                  # 交互式对话测试
  python test_dify.py --ping           # 仅测试连通性
  python test_dify.py --generate       # 快速测试 Give_Result 生成角色卡
"""

import requests
import json
import sys
import argparse
from datetime import datetime

# ===== 配置 =====
DIFY_API_KEY = "app-DSWr4bHWVbGUYObbzeHMmtvz"
DIFY_BASE_URL = "https://api.dify.ai/v1"
TEST_USER = "test_user_001"

HEADERS = {
    "Authorization": f"Bearer {DIFY_API_KEY}",
    "Content-Type": "application/json",
}


def log(msg: str, level: str = "INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    prefix = {"INFO": "✅", "WARN": "⚠️", "ERROR": "❌", "SEND": "📤", "RECV": "📥"}.get(level, "ℹ️")
    print(f"[{ts}] {prefix} {msg}")


def ping() -> bool:
    """测试 API 连通性：发送一条简单消息"""
    log("正在测试 Dify API 连通性...")
    try:
        resp = requests.post(
            f"{DIFY_BASE_URL}/chat-messages",
            headers=HEADERS,
            json={
                "inputs": {},
                "query": "你好",
                "response_mode": "blocking",
                "conversation_id": "",
                "user": TEST_USER,
            },
            timeout=120,
        )

        if resp.status_code == 200:
            data = resp.json()
            answer = data.get("answer", "")[:100]
            conv_id = data.get("conversation_id", "")
            log(f"连接成功！状态码: {resp.status_code}")
            log(f"会话 ID: {conv_id}")
            log(f"AI 回复: {answer}...", "RECV")
            return True
        else:
            log(f"请求失败，状态码: {resp.status_code}", "ERROR")
            log(f"响应: {resp.text[:300]}", "ERROR")
            return False

    except requests.exceptions.Timeout:
        log("请求超时 (120s)，请检查网络或 Dify 服务状态", "ERROR")
        return False
    except requests.exceptions.ConnectionError as e:
        log(f"连接失败: {e}", "ERROR")
        return False
    except Exception as e:
        log(f"未知错误: {e}", "ERROR")
        return False


def send_message(query: str, conversation_id: str = "") -> dict | None:
    """发送一条消息到 Dify"""
    try:
        resp = requests.post(
            f"{DIFY_BASE_URL}/chat-messages",
            headers=HEADERS,
            json={
                "inputs": {},
                "query": query,
                "response_mode": "blocking",
                "conversation_id": conversation_id,
                "user": TEST_USER,
            },
            timeout=120,
        )

        if resp.status_code == 200:
            return resp.json()
        else:
            log(f"请求失败 [{resp.status_code}]: {resp.text[:200]}", "ERROR")
            return None

    except Exception as e:
        log(f"发送失败: {e}", "ERROR")
        return None


def test_generate():
    """快速测试：发送几条描述 → Give_Result → 验证 JSON"""
    log("=== 角色卡生成流程测试 ===")

    # Step 1: 初始描述
    log("发送角色描述...", "SEND")
    result = send_message("我想创建一个角色：一个来自异世界的精灵弓箭手，名叫艾拉，性格冷静但内心温柔，擅长远程攻击。")
    if not result:
        log("初始对话失败，终止测试", "ERROR")
        return

    conv_id = result.get("conversation_id", "")
    log(f"会话 ID: {conv_id}")
    log(f"AI: {result['answer'][:150]}...", "RECV")

    # Step 2: 发送 Give_Result
    log("")
    log("发送 Give_Result 请求生成角色卡...", "SEND")
    result = send_message("Give_Result", conv_id)
    if not result:
        log("Give_Result 请求失败", "ERROR")
        return

    answer = result.get("answer", "")
    log(f"原始回复长度: {len(answer)} 字符")

    # 尝试解析 JSON
    char_data = extract_json(answer)
    if char_data:
        log("角色卡 JSON 解析成功！", "INFO")
        log(f"角色名: {char_data.get('name', '未知')}")
        log(f"性别: {char_data.get('gender', '未知')}")
        log(f"简介: {(char_data.get('introduction', '') or '')[:80]}...")
        log(f"性格标签: {char_data.get('personalityTags', char_data.get('personality_tags', []))}")

        # 检查关键字段
        required = ["name", "gender", "species", "introduction", "personality", "backstory", "appearance", "radar"]
        missing = [f for f in required if not char_data.get(f)]
        if missing:
            log(f"缺少字段: {missing}", "WARN")
        else:
            log("所有必填字段均存在 ✓")

        # 输出完整 JSON（格式化）
        print("\n" + "=" * 50)
        print("完整角色卡 JSON:")
        print("=" * 50)
        print(json.dumps(char_data, ensure_ascii=False, indent=2))
    else:
        log("无法从回复中解析出 JSON", "ERROR")
        print("\n原始回复:")
        print(answer[:1000])


def extract_json(text: str) -> dict | None:
    """从文本中提取 JSON（兼容 markdown 代码块）"""
    import re

    # 1. 尝试 ```json ... ``` 代码块
    m = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", text)
    json_str = m.group(1).strip() if m else text.strip()

    # 2. 直接解析
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    # 3. 提取第一个 { ... } 块
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last > first:
        try:
            return json.loads(text[first : last + 1])
        except json.JSONDecodeError:
            pass

    return None


def interactive_chat():
    """交互式对话模式"""
    log("=== Dify 交互式对话测试 ===")
    log("输入消息与 AI 对话，输入以下命令执行特殊操作：")
    print("  /result   - 发送 Give_Result 生成角色卡")
    print("  /quit     - 退出")
    print("  /new      - 开始新会话")
    print()

    conv_id = ""

    while True:
        try:
            user_input = input("你: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not user_input:
            continue

        if user_input == "/quit":
            break
        elif user_input == "/new":
            conv_id = ""
            log("已开始新会话")
            continue
        elif user_input == "/result":
            user_input = "Give_Result"
            log("发送 Give_Result...", "SEND")

        result = send_message(user_input, conv_id)
        if result:
            conv_id = result.get("conversation_id", conv_id)
            answer = result.get("answer", "")
            print(f"\nAI: {answer}\n")

            # 如果是 Give_Result，尝试解析
            if user_input == "Give_Result":
                char_data = extract_json(answer)
                if char_data:
                    log("检测到角色卡 JSON，解析成功！")
                    log(f"角色名: {char_data.get('name', '?')}")
        else:
            log("获取回复失败", "ERROR")

    log("对话结束")


def main():
    parser = argparse.ArgumentParser(description="Dify API 连通性测试工具")
    parser.add_argument("--ping", action="store_true", help="仅测试连通性")
    parser.add_argument("--generate", action="store_true", help="快速测试角色卡生成")
    args = parser.parse_args()

    print(f"Dify API: {DIFY_BASE_URL}")
    print(f"API Key:  {DIFY_API_KEY[:10]}...{DIFY_API_KEY[-4:]}")
    print()

    if args.ping:
        success = ping()
        sys.exit(0 if success else 1)
    elif args.generate:
        if not ping():
            sys.exit(1)
        print()
        test_generate()
    else:
        if not ping():
            sys.exit(1)
        print()
        interactive_chat()


if __name__ == "__main__":
    main()
