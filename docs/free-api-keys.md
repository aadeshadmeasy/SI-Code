# Get free API keys

SI Code does not ship a model key. These providers offer a free key or a free tier you can paste into **SI Code: Get Free API Keys**. Add asks for the key, fills in the endpoint, and shows the models in a dropdown. The key is stored in the editor's secret storage.

Quotas change. Confirm the current free tier on the provider's site before you rely on it.

| Provider | Get a key | Endpoint | Suggested model |
| --- | --- | --- | --- |
| Google Gemini | [Google AI Studio](https://aistudio.google.com/apikey) | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.5-flash` |
| Groq | [Groq console](https://console.groq.com/keys) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | [OpenRouter keys](https://openrouter.ai/keys) | `https://openrouter.ai/api/v1` | `openrouter/free` |
| Cerebras | [Cerebras Cloud](https://cloud.cerebras.ai/) | `https://api.cerebras.ai/v1` | `llama3.1-8b` |
| Mistral | [Mistral console](https://console.mistral.ai/api-keys) | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| Hugging Face | [Access tokens](https://huggingface.co/settings/tokens) | `https://router.huggingface.co/v1` | `meta-llama/Llama-3.3-70B-Instruct` |
| NVIDIA NIM | [build.nvidia.com](https://build.nvidia.com/) | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.3-70b-instruct` |
| Cloudflare Workers AI | [Cloudflare dashboard](https://dash.cloudflare.com/) | `https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Sarvam | [Sarvam dashboard](https://dashboard.sarvam.ai/) | `https://api.sarvam.ai/v1` | `sarvam-105b` |
| Ollama | Local install, no key | `http://127.0.0.1:11434/v1` | `llama3.2` |
| LM Studio | Local app, no key | `http://127.0.0.1:1234/v1` | the model loaded in LM Studio |

## What each free tier is

- **Google AI Studio** issues a Gemini API key without a credit card. Requests are limited by a daily free-tier quota.
- **Groq** issues an API key from the console without a credit card. The free tier is rate limited.
- **OpenRouter** includes free models. `openrouter/free` routes to a free model, and model ids ending in `:free` are free. Creating a key does not require a credit card.
- **Cerebras** offers a free inference tier on its OpenAI-compatible API.
- **Mistral** La Plateforme has an experiment tier for open models.
- **Hugging Face** tokens can call the router, with a free serverless quota.
- **NVIDIA NIM** developer keys from build.nvidia.com call hosted models at `integrate.api.nvidia.com`.
- **Cloudflare Workers AI** includes a daily free allocation. Replace `ACCOUNT_ID` in the endpoint with your account id, then paste a Workers AI API token.
- **Sarvam** adds signup credits to a new key. Chat uses the OpenAI-compatible endpoint. SI Code sends the key as `Authorization: Bearer` and as `api-subscription-key`.
- **Ollama** and **LM Studio** run on this computer. SI Code uses a placeholder key so the local server can be added without a provider account.

## Retired

GitHub Models retired on July 30, 2026. The inference API is no longer available, so SI Code does not offer it as a provider.

## Paid presets

OpenAI, Anthropic, Amazon Bedrock, Azure OpenAI, DeepSeek, xAI, Together, and Fireworks are built in as well. Add them from **SI Code: Configure AI**. Bedrock asks for an AWS access key, secret key, optional session token, and region, then calls the Converse API. Any other OpenAI-compatible server can be added as a custom endpoint.
