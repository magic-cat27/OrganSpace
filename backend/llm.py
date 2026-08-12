"""Unified LLM wrapper — supports DeepSeek (OpenAI-compatible) and Anthropic."""

import time
import asyncio
import httpx
from openai import OpenAI, AsyncOpenAI

# 单次 LLM 调用超时（秒）。与前端 45s 超时匹配：重试 1 次后总耗时 < 45s。
LLM_TIMEOUT = 20.0
LLM_RETRIES = 1


class LLMClient:
    """A unified LLM client."""

    def __init__(self, provider: str, api_key: str, base_url: str = None):
        self.provider = provider
        self.api_key = api_key
        self.base_url = base_url or "https://api.deepseek.com"

        if provider == "deepseek":
            http_client = httpx.Client(timeout=LLM_TIMEOUT, proxy=None)
            self.client = OpenAI(api_key=api_key, base_url=self.base_url, http_client=http_client)
        elif provider == "anthropic":
            from anthropic import Anthropic
            self.client = Anthropic(api_key=api_key, timeout=LLM_TIMEOUT)
        else:
            raise ValueError(f"Unknown LLM provider: {provider}")

    def chat(self, model: str, system: str, messages: list[dict],
             max_tokens: int = 1024, temperature: float = 0.3) -> str:
        """Sync chat completion with bounded retry."""
        last_exc = None
        for attempt in range(LLM_RETRIES + 1):
            try:
                if self.provider == "deepseek":
                    full_messages = [{"role": "system", "content": system}] + messages
                    response = self.client.chat.completions.create(
                        model=model, messages=full_messages,
                        max_tokens=max_tokens, temperature=temperature,
                    )
                    return response.choices[0].message.content
                elif self.provider == "anthropic":
                    response = self.client.messages.create(
                        model=model, max_tokens=max_tokens, temperature=temperature,
                        system=system, messages=messages,
                    )
                    return response.content[0].text
            except Exception as e:  # noqa: BLE001 — 网络/限流等外部错误需要重试
                last_exc = e
                if attempt < LLM_RETRIES:
                    time.sleep(0.5)
        raise last_exc

    async def chat_async(self, model: str, system: str, messages: list[dict],
                         max_tokens: int = 1024, temperature: float = 0.3):
        """Async chat — uses AsyncOpenAI for deepseek, with bounded retry."""
        last_exc = None
        for attempt in range(LLM_RETRIES + 1):
            try:
                if self.provider == "deepseek":
                    async with httpx.AsyncClient(timeout=LLM_TIMEOUT, proxy=None) as http:
                        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, http_client=http)
                        full_msgs = [{"role": "system", "content": system}] + messages
                        response = await client.chat.completions.create(
                            model=model, messages=full_msgs,
                            max_tokens=max_tokens, temperature=temperature,
                        )
                        return response.choices[0].message.content
                else:
                    return await asyncio.to_thread(self.chat, model, system, messages, max_tokens, temperature)
            except Exception as e:  # noqa: BLE001
                last_exc = e
                if attempt < LLM_RETRIES:
                    await asyncio.sleep(0.5)
        raise last_exc
