#!/usr/bin/env python3
"""
icloud-hme 自动注册助手
流程: 登录 → 生成 HME 别名 → (回调)目标站注册 → 轮询收件箱 → 提取验证码
仅用于授权测试场景(CTF 靶场/自有服务)。
"""
import argparse
import json
import re
import sys
import time
from typing import Callable, Optional

import requests

CODE_PATTERNS = [
    r"(?:验证码|verification code|code is|您的代码|OTP)\D{0,10}(\d{4,8})",
    r"\b(\d{6})\b",
    r"\b(\d{4,8})\b",
]


class HMEClient:
    def __init__(self, base: str, password: str):
        self.base = base.rstrip("/")
        self.s = requests.Session()
        self.csrf = ""
        r = self.s.post(f"{self.base}/api/auth/login",
                        json={"password": password}, timeout=15)
        data = r.json()
        if not data.get("success"):
            sys.exit(f"登录失败: {data}")
        self.csrf = self.s.get(f"{self.base}/api/auth/session",
                               timeout=15).json()["data"]["csrf_token"]

    def _h(self) -> dict:
        return {"X-CSRF-Token": self.csrf}

    def accounts(self) -> list:
        r = self.s.get(f"{self.base}/api/accounts", timeout=15).json()
        if not r.get("success"):
            sys.exit(f"获取账号失败: {r}")
        return r["data"]

    def pick_account(self, account_id: str = "") -> str:
        accs = self.accounts()
        if account_id:
            return account_id
        active = [a for a in accs if a["status"] == "active"]
        if not active:
            sys.exit(f"无可用账号: {accs}")
        return active[0]["id"]

    def create_alias(self, account_id: str, label: str) -> str:
        r = self.s.post(f"{self.base}/api/create", headers=self._h(),
                        json={"account_id": account_id, "label": label},
                        timeout=60).json()
        if not r.get("success"):
            sys.exit(f"生成别名失败: {r}")
        return r["data"]["email"]

    def inbox(self, account_id: str, alias: str, limit=10, days=1) -> list:
        r = self.s.get(f"{self.base}/api/inbox", timeout=60,
                       params={"account_id": account_id, "alias": alias,
                               "limit": limit, "days": days}).json()
        if not r.get("success"):
            return []
        return r["data"].get("messages", [])

    def message(self, account_id: str, msg_id: str) -> dict:
        r = self.s.get(f"{self.base}/api/inbox/{msg_id}",
                       params={"account_id": account_id}, timeout=60).json()
        return r.get("data", {})

    def wait_code(self, account_id: str, alias: str, timeout=120,
                  interval=5) -> Optional[str]:
        deadline = time.time() + timeout
        seen = set()
        while time.time() < deadline:
            for m in self.inbox(account_id, alias):
                if m["id"] in seen:
                    continue
                seen.add(m["id"])
                text = f"{m.get('subject','')} {m.get('preview','')}"
                code = extract_code(text)
                if not code:
                    full = self.message(account_id, m["id"])
                    code = extract_code(f"{full.get('subject','')} {full.get('body','')}")
                if code:
                    return code
            time.sleep(interval)
        return None


def extract_code(text: str) -> Optional[str]:
    for pat in CODE_PATTERNS:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def register_example(alias: str, target: str) -> None:
    """占位: 在此实现目标站点的注册请求。CTF 场景按靶场接口自行填写。"""
    print(f"[注册] 在 {target} 上使用 {alias} 注册 (请自行实现)")


def batch(args) -> None:
    """批量模式: 循环 生成别名 → 注册 → 收码, 汇总为 JSON 数组。"""
    cli = HMEClient(args.base, args.password)
    acc = cli.pick_account(args.account)
    results = []
    failed = 0
    for i in range(args.count):
        label = f"{args.label}-{i + 1}"
        print(f"\n===== [{i + 1}/{args.count}] {label} =====")
        try:
            alias = cli.create_alias(acc, label)
            print(f"[别名] {alias}")
            register_example(alias, args.target)
            code = cli.wait_code(acc, alias, timeout=args.timeout)
            if code:
                print(f"[验证码] {code}")
                results.append({"label": label, "alias": alias, "code": code})
            else:
                print(f"[超时] {args.timeout}s 内未收到验证码")
                failed += 1
                results.append({"label": label, "alias": alias, "code": None})
        except SystemExit:
            raise
        except Exception as e:
            print(f"[失败] {e}")
            failed += 1
            results.append({"label": label, "alias": None, "error": str(e)})
        if i < args.count - 1:
            time.sleep(args.interval)  # 降低 iCloud 限频风险

    ok = sum(1 for r in results if r.get("code"))
    print(f"\n===== 汇总: 成功 {ok}/{args.count}, 失败 {failed} =====")
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"结果已写入 {args.output}")


def main() -> None:
    ap = argparse.ArgumentParser(description="icloud-hme 自动注册助手")
    ap.add_argument("--base", default="http://localhost:8081")
    ap.add_argument("--password", required=True, help="管理员密码")
    ap.add_argument("--account", default="", help="账号 ID, 默认取第一个 active")
    ap.add_argument("--label", default="autoreg")
    ap.add_argument("--target", default="", help="目标站地址(传给注册回调)")
    ap.add_argument("--timeout", type=int, default=120, help="等验证码秒数")
    ap.add_argument("--count", type=int, default=1, help="批量数量, >1 启用批量模式")
    ap.add_argument("--interval", type=int, default=10, help="批量间隔秒数")
    ap.add_argument("--output", default="autoreg_result.json", help="批量结果输出文件")
    args = ap.parse_args()

    if args.count > 1:
        batch(args)
        return

    cli = HMEClient(args.base, args.password)
    acc = cli.pick_account(args.account)
    alias = cli.create_alias(acc, args.label)
    print(f"[别名] {alias}")

    register_example(alias, args.target)

    print(f"[等待] 最多 {args.timeout}s ...")
    code = cli.wait_code(acc, alias, timeout=args.timeout)
    if code:
        print(f"[验证码] {code}")
    else:
        print("[超时] 未收到验证码")
        sys.exit(1)

    result = {"alias": alias, "code": code, "account_id": acc}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
