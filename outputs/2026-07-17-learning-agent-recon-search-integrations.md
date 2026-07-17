# Learning Agent recon/web-research capability — provider survey and roadmap

2026-07-17. Source: Parallel.ai FindAll API run `findall_f1276700e2d243b4a9069467727fd8ce` (generator `base`, match_limit 50, cost $1.63) — 178 raw candidates (46 matched Parallel-competitor conditions, 132 unmatched). Every one of the 178 was reviewed here for relevance to the Learning Agent's LA3 web-research/recon capability (`docs/raw/learning-agent-roadmap-2026-07.md` §7), not just the 46 that satisfied FindAll's original "Parallel.ai competitor" match conditions — several genuinely useful recon tools (DuckDuckGo, Serper, Zenserp, NewsCatcher, Apify, Browserbase, Webz.io, Klue, Contify, ZenRows, ScrapingBee, Scrapingdog, Octoparse, Browse AI, fastCRW, Google Custom Search) had been marked `unmatched` because they weren't framed as Parallel competitors in the retrieved excerpts, not because they're irrelevant.

Tiering rule (user-directed): **Tier 1** = free, agent can call it directly today with no account/signup (the bar Parallel's own Search MCP sets). **Tier 2** = free tier exists but requires account/API-key creation. **Tier 3** = paid, self-hosted-only/no public hosted endpoint, or otherwise doesn't clear Tier 1/2.

## Tier 1 — free, direct access, no account (use first)

| Provider | Why it clears Tier 1 |
|---|---|
| **Parallel Search MCP** (`https://search.parallel.ai/mcp`) | Already verified this session — anonymous HTTP MCP endpoint, `web_search`/`web_fetch` tools, $0, no key. Reference bar for this tier. |
| **Jina AI Search Foundation** (`s.jina.ai`, `r.jina.ai`) | `search`/`read`/`deepsearch` callable via plain HTTP GET with no key at working (rate-limited) volume; a free key only raises the ceiling, it isn't required to start. |
| **DuckDuckGo Instant Answer API** (`api.duckduckgo.com`) | Public JSON endpoint, no key, no signup, ever. Narrower coverage (instant-answer style, not full SERP) but genuinely zero-friction. |

## Tier 2 — free tier, requires signup/API key

Exa · Tavily · You.com API · Brave Search API · SerpAPI · Serper · Firecrawl · Linkup · Zenserp · Google Custom Search JSON API (incl. Programmable Search Engine) · Apify · ZenRows · ScrapingBee · Scrapingdog · Browserbase · Hyperbrowser · Browse AI · Octoparse · Spider.cloud · Scrapeless · ScrapeGraphAI · Steel.dev · Olostep · Zyte · LLMLayer · fastCRW · Scrapfly · Upstage · ZAI (Z.AI) · Diffbot (time-limited trial, not perpetual) · ScraperAPI · NewsCatcher · Browser Use (cloud product — the OSS library itself is Tier 3)

33 providers. Each needs a stored credential in Bridge's existing vault pattern (same shape as DealPilot Source credentials, TASK-006) before use; none require payment at evaluation volume.

## Tier 3 — paid, self-hosted-only, or enterprise-gated

| Provider | Why Tier 3 |
|---|---|
| Perplexity Sonar | No free API tier |
| Bright Data, Oxylabs, Nimble, Nebius, Azure AI Search, Reworkd | Enterprise/paid-only pricing |
| Webz.io | Enterprise paid — dark/deep-web feeds, genuinely OSINT-relevant if ever justified |
| Klue, Contify | Enterprise competitive-intelligence platforms, paid |
| xAI / Grok API | Paid API access |
| DataForSEO | Pay-as-you-go from account creation, no meaningful free tier |
| Gemini Deep Research Agent (Google) | Real research API, but paid/Google-Cloud-billed |
| Roundproxies | Proxy reseller — infra underneath a scraper, not a search API itself |
| Crawl4AI, Scrapy | Open-source libraries — no hosted endpoint, agent would need to run/deploy them |
| OrioSearch, Vane | Open-source, self-hosted search/answer engines |
| SearXNG | Self-hostable meta-search; public instances exist but aren't a reliable or ToS-safe programmatic target |

## Discarded — 112 of 178, not relevant to a web-search/recon capability

Grouped by reason (none of these are search, extraction, or recon-data-gathering products):

**Coding agents / IDE assistants (19)** — Gemini CLI, OpenCode, OpenCode Zen, Oh My Pi, AWS Kiro, Bolt.new, Sourcery, JetBrains AI Assistant, Warp, Qoder, Trae, Jules, Bito, Roo Code, Amazon Q Developer, Rovo Dev CLI, Gumloop, Activepieces, Relay.app

**LLM inference/compute infrastructure (17)** — NVIDIA NIM, Inference.net, Hyperbolic, DeepInfra, Groq, Cerebras, Novita AI, SiliconFlow, Fireworks AI, Baseten, OVHcloud AI Endpoints, SambaNova Cloud, Chutes AI, Cloudflare Workers AI, OpenRouter, Vercel AI Gateway, Vercel AI SDK

**Foundation-model / chat-assistant vendors (18)** — web search, where present, is a bundled model feature, not a standalone recon API; adopting it would mean replacing the whole LLM backend, not adding a Skill. Gemini, Google AI Studio, Google SGE Labs, Claude, Anthropic, "Anthropic, Extraction API" (malformed dup), OpenAI, DeepSeek, Mistral AI, Mistral Le Chat, Cohere, AI21 Labs, Meta, Xiaomi MiMo, Google (generic), Microsoft (generic), "Microsoft, Extraction API" (malformed dup), Microsoft Bing / Bing Web Search API (retired August 2025 — confirmed independently by the earlier free `web_search` pass too)

**AI dev-tooling / RAG / vector-DB / eval frameworks (13)** — adjacent infra, not a web-data source. Chroma Cloud, Weaviate, LlamaIndex, Haystack, LangChain, LangSmith, RAGAS, DeepEval, Vellum, Guidance, Weights & Biases, Hugging Face, NLP Cloud

**Vertical/unrelated SaaS (17)** — no recon relevance. DocLegal.Ai, DocuLex.ai, Spellbook, Harvey AI, OpenEvidence, Trially, HippocratesAI, Emilie Scientific, Canva, QuillBot, Humata, Pangram Labs AI Detection API, Anomaly AI, Flourish Software, Giga AI, OfoxAI, Julius AI

**Other out-of-category (7)** — Adept, Adept AI (enterprise agent orchestration), MemPalace (AI memory tool), Fathom (meeting notes), Nous Research (model lab), Phind (consumer dev-search UI, no public recon-suited API), Kernel (insufficient information to identify a real distinct product)

**Duplicates/rebrands already counted under their real entry (5)** — Metaphor Systems (Exa's old name → counted as Exa), Perplexity AI (consumer app → counted as Perplexity Sonar), "Jina AI, Deep research API" (duplicate pitchbook-sourced row → counted as Jina AI), Google Programmable Search Engine (duplicate → counted as Google Custom Search JSON API), Grok (duplicate → counted as xAI)

**FindAll generator noise — not real, distinct companies (16)** — garbled entity names or unrelated small/local businesses the generator mismatched against search snippets. CatchAll AI-native web search API, "Together AI, AI-native web search API" (garbled; real Together AI already excluded above as inference infra), Founder of HF Group Technology Holding Company, NewState Holdings, Enter Tech Corporation, Sletpetro, Green Zone Capital, Biozek Rapid Test, Quanta of Meaning, SS Technology, LEAF slrs, PrixAI, Deluso Investments Ltd., Veo, Biomnigene, iDataEntry.us, Hauser Contract Research Organization, Ripl, Memorang, "Agent Search APIs" (a Vellum blog-post title, not a company), "Web data API" (a market-map aggregator page, not a company), "Context API (search & scrape for agents)" (a generic phrase, not a company)

**The reference platform itself (1)** — Parallel AI (excluded as the subject of the comparison, not an alternative)

## Roadmap — rollout into the Learning Agent

Full decision record: `docs/raw/decisions-log.md` ADR-111. Task: `docs/TASKS.md` TASK-023. Roadmap section: `docs/raw/learning-agent-roadmap-2026-07.md` §7 (LA3).

- **Phase 1 ($0, ships first).** Add a provider-agnostic `SearchProvider` port (same port/adapter shape as `ModelProvider`/`MemoryStore`/`ContentGuard`) to the Learning Agent's LA3 research lane. Wire the three Tier 1 sources behind it: Parallel Search MCP, Jina AI (keyless mode), DuckDuckGo Instant Answer. Every fetched result is tagged `untrusted_external` taint per the already-shipped PI-1/PI-2 pipeline before it can reach a Memory or prompt.
- **Phase 2 (still $0 at evaluation volume, needs credential provisioning).** Add 2-4 Tier 2 providers as additional adapters behind the same port for when Tier 1 coverage is insufficient — Exa or Tavily for semantic/synthesized research, Firecrawl or Apify for structured extraction, Browserbase or Steel.dev for JS-heavy/interactive pages. API keys go in the existing credential vault (same pattern DealPilot Sources already use). Do not wire all 33 Tier 2 candidates — start with 2-4 proven providers and expand only on demonstrated need, per the "build only what creates lasting value" principle.
- **Phase 3 (paid, evaluation-gated).** Tier 3 providers (Webz.io for OSINT/dark-web feeds, Klue/Contify for competitive intelligence, Gemini Deep Research for heavier synthesis) are evaluated only after a real recon need proves Phase 1/2 insufficient, and only behind a cost/ROI proposal with an explicit `docs/APPROVALS.md` gate before any spend — consistent with how FindAll itself required an explicit user go-ahead this session before it was called.
- **Non-goal for now.** Self-hosted-only Tier 3 items (SearXNG, Crawl4AI, Vane, OrioSearch, Scrapy) need a hosting decision Bridge hasn't made; deferred indefinitely, not rejected.
