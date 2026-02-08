"""
测试从国内网络访问 api.dify.ai 的连通性
在本机运行，模拟云函数的网络环境诊断

使用: python test_tool/test_cloud_connectivity.py
"""

import socket
import time
import json

def test_dns():
    """DNS 解析测试"""
    print("[1/3] DNS 解析 api.dify.ai ...")
    try:
        start = time.time()
        ips = socket.getaddrinfo("api.dify.ai", 443, socket.AF_INET)
        elapsed = (time.time() - start) * 1000
        unique_ips = list(set(addr[4][0] for addr in ips))
        print(f"  ✅ 解析成功 ({elapsed:.0f}ms)")
        print(f"  IP: {', '.join(unique_ips)}")
        return True
    except Exception as e:
        print(f"  ❌ DNS 解析失败: {e}")
        return False

def test_tcp():
    """TCP 连接测试"""
    print("[2/3] TCP 连接 api.dify.ai:443 ...")
    try:
        start = time.time()
        sock = socket.create_connection(("api.dify.ai", 443), timeout=10)
        elapsed = (time.time() - start) * 1000
        sock.close()
        print(f"  ✅ TCP 连接成功 ({elapsed:.0f}ms)")
        return True
    except Exception as e:
        print(f"  ❌ TCP 连接失败: {e}")
        return False

def test_https():
    """HTTPS API 调用测试"""
    print("[3/3] HTTPS API 请求测试 ...")
    try:
        import urllib.request
        import ssl

        url = "https://api.dify.ai/v1/parameters?user=connectivity_test"
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer app-DSWr4bHWVbGUYObbzeHMmtvz"
        })

        ctx = ssl.create_default_context()
        start = time.time()
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        elapsed = (time.time() - start) * 1000
        status = resp.status
        body = resp.read().decode()[:200]
        print(f"  ✅ HTTPS 请求成功 ({elapsed:.0f}ms)")
        print(f"  HTTP {status}: {body}")
        return True
    except Exception as e:
        print(f"  ❌ HTTPS 请求失败: {e}")
        return False

def main():
    print("=" * 50)
    print("Dify API 连通性诊断")
    print("目标: https://api.dify.ai")
    print("=" * 50)
    print()

    dns_ok = test_dns()
    print()
    tcp_ok = test_tcp()
    print()
    https_ok = test_https()

    print()
    print("=" * 50)
    print("诊断结果:")
    print("=" * 50)

    if dns_ok and tcp_ok and https_ok:
        print("✅ 本地网络可正常访问 api.dify.ai")
        print()
        print("但微信云函数在腾讯云机房运行，可能仍然无法访问。")
        print("请在微信开发者工具中重新部署 difyChat 云函数后，")
        print('在小程序调试器 Console 中执行：')
        print()
        print('  wx.cloud.callFunction({name:"difyChat",data:{action:"ping"}})')
        print('    .then(r=>console.log(JSON.stringify(r.result,null,2)))')
        print()
        print("这会在云函数内部测试到 Dify 的连通性。")
    elif dns_ok and not tcp_ok:
        print("⚠️  DNS 正常但 TCP 连不上，可能被防火墙拦截")
        print("api.dify.ai 在 AWS 海外，国内网络/云函数可能无法直连")
    elif not dns_ok:
        print("❌ DNS 解析失败，api.dify.ai 无法解析")

    print()
    print("如果云函数确实无法访问 api.dify.ai，解决方案：")
    print("  1. 使用 Dify 国内部署版本（如有）")
    print("  2. 在国内服务器自建 Dify 实例")
    print("  3. 改为前端直接调用 Dify API（需接受 API Key 暴露风险）")
    print("  4. 通过国内中转代理访问 Dify API")

if __name__ == "__main__":
    main()
