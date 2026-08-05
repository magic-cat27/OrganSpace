"""Unified LLM wrapper — supports DeepSeek (OpenAI-compatible) and Anthropic."""

import httpx
from openai import OpenAI, AsyncOpenAI


class LLMClient:
    """A unified LLM client."""

    def __init__(self, provider: str, api_key: str, base_url: str = None):
        self.provider = provider
        self.api_key = api_key
        self.base_url = base_url or "https://api.deepseek.com"

        if provider == "deepseek":
            http_client = httpx.Client(timeout=60.0, proxy=None)
            self.client = OpenAI(api_key=api_key, base_url=self.base_url, http_client=http_client)
        elif provider == "anthropic":
            from anthropic import Anthropic
            self.client = Anthropic(api_key=api_key)
        else:
            raise ValueError(f"Unknown LLM provider: {provider}")

    def chat(self, model: str, system: str, messages: list[dict],
             max_tokens: int = 1024, temperature: float = 0.3) -> str:
        """Sync chat completion."""
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

    async def chat_async(self, model: str, system: str, messages: list[dict],
                         max_tokens: int = 1024, temperature: float = 0.3):
        """Async chat — uses AsyncOpenAI for deepseek."""
        if self.provider == "deepseek":
            async with httpx.AsyncClient(timeout=60.0, proxy=None) as http:
                client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, http_client=http)
                full_msgs = [{"role": "system", "content": system}] + messages
                response = await client.chat.completions.create(
                    model=model, messages=full_msgs,
                    max_tokens=max_tokens, temperature=temperature,
                )
                return response.choices[0].message.content
        else:
            import asyncio
            return await asyncio.to_thread(self.chat, model, system, messages, max_tokens, temperature)
