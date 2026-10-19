# Third-party notices

Original code and documentation in DSH Web Search Plugins are licensed under
the MIT License in [LICENSE](LICENSE), copyright (c) 2026 ACE089. Third-party
materials retain their original copyright and license terms.

## GLM search plugin

The bundled `packages/web-search-glm/index.mjs` includes the MCP client and
supporting libraries. Their copyright notices and full license texts are
preserved in [the GLM package notices](packages/web-search-glm/THIRD_PARTY_NOTICES.md):

- `@deepseek-ai/cosmokit` 1.8.5
- `@deepseek-ai/schemastery` 3.18.4
- `@modelcontextprotocol/client` 2.0.0
- `@modelcontextprotocol/core` 2.0.0
- `eventsource` 3.0.7
- `eventsource-parser` 3.1.1
- `jose` 6.2.12
- `pkce-challenge` 5.0.1
- `zod` 4.6.7

The build script regenerates these notices from the actual bundled inputs.
The complete notice file is included in the GLM `.tgz` package.

## Web search policy plugin

The web verification guidance was adapted with reference to OpenAI Codex
commit `a9b0815167c27ab13719dd12d13b63e02b70d221`, licensed under Apache-2.0.
Applicable upstream attribution, the adaptation notice, and the full Apache
License are preserved in [the policy package notices](packages/web-search-policy/THIRD_PARTY_NOTICES.md).

The policy `.tgz` includes these notices alongside the project's MIT License.
The project MIT License does not replace the original terms of third-party
materials.
