#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
共用配置檔案
"""

import os
from pathlib import Path

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
共用配置檔案（GPT-5.2 版本）
- API Key 從環境變數讀取，避免硬編碼外洩
- 預設使用 gpt-5.2
- 補上 GPT-5.2 常用參數：reasoning.effort、text.verbosity、max_output_tokens
"""

import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Config:
    """全域配置類"""

    # === OpenAI API 設定（務必用環境變數） ===
    # export OPENAI_API_KEY="sk-..."
    OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")

    # GPT-5.2 模型設定
    # 可用：gpt-5.2 / gpt-5.2-pro / gpt-5-mini / gpt-5-nano
    MODEL: str = os.getenv("OPENAI_MODEL", "gpt-5.2")

    # Responses API 的輸出 token 上限（取代你原本的 GPT_MAX_TOKENS 概念）
    MAX_OUTPUT_TOKENS: int = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "5000"))

    # GPT-5.2 的 reasoning effort：none / low / medium / high / xhigh
    REASONING_EFFORT: str = os.getenv("OPENAI_REASONING_EFFORT", "none")

    # GPT-5.2 的 verbosity：low / medium / high
    VERBOSITY: str = os.getenv("OPENAI_VERBOSITY", "medium")

    # （可選）temperature：僅在 reasoning.effort = "none" 時才建議/允許使用
    TEMPERATURE: float = float(os.getenv("OPENAI_TEMPERATURE", "0.2"))

    # === 日誌設定 ===
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_FORMAT: str = os.getenv(
        "LOG_FORMAT",
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    # 檔案命名格式
    TIMESTAMP_FORMAT: str = os.getenv("TIMESTAMP_FORMAT", "%Y%m%d_%H%M%S")

    @staticmethod
    def validate():
        """驗證必要設定與參數合法性"""
        if not Config.OPENAI_API_KEY:
            raise ValueError("缺少 OPENAI_API_KEY：請設定環境變數 OPENAI_API_KEY")

        allowed_effort = {"none", "low", "medium", "high", "xhigh"}
        if Config.REASONING_EFFORT not in allowed_effort:
            raise ValueError(
                f"OPENAI_REASONING_EFFORT 必須是 {sorted(allowed_effort)}，"
                f"但收到：{Config.REASONING_EFFORT}"
            )

        allowed_verbosity = {"low", "medium", "high"}
        if Config.VERBOSITY not in allowed_verbosity:
            raise ValueError(
                f"OPENAI_VERBOSITY 必須是 {sorted(allowed_verbosity)}，"
                f"但收到：{Config.VERBOSITY}"
            )

        if Config.MAX_OUTPUT_TOKENS <= 0:
            raise ValueError("OPENAI_MAX_OUTPUT_TOKENS 必須 > 0")

        return True



