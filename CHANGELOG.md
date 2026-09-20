# Changelog

## [1.0.0](https://github.com/chrischall/accessoticketing-mcp/compare/v0.3.0...v1.0.0) (2026-09-20)


### Features

* **deps:** take mcp-utils 1.0.0, fixing server/discover ([#48](https://github.com/chrischall/accessoticketing-mcp/issues/48)) ([99d4fe9](https://github.com/chrischall/accessoticketing-mcp/commit/99d4fe98e4a72e2a5f61dceea392bed4c56f3cf6))


### Bug Fixes

* **release:** restate the Release-As footer the squash dropped ([#51](https://github.com/chrischall/accessoticketing-mcp/issues/51)) ([6c43bdf](https://github.com/chrischall/accessoticketing-mcp/commit/6c43bdf6d0f1a014eb41adacc5d152f9b3f246ec))
* **release:** stop downgrading breaking changes to a minor ([#50](https://github.com/chrischall/accessoticketing-mcp/issues/50)) ([7aa688b](https://github.com/chrischall/accessoticketing-mcp/commit/7aa688beec03e6f07f2c1f44b42de473463fb62f))

## [0.3.0](https://github.com/chrischall/accessoticketing-mcp/compare/v0.2.1...v0.3.0) (2026-09-17)


### ⚠ BREAKING CHANGES

* **mcp:** migrate server to SDK v2 ([#43](https://github.com/chrischall/accessoticketing-mcp/issues/43))

### Features

* **mcp:** migrate server to SDK v2 ([#43](https://github.com/chrischall/accessoticketing-mcp/issues/43)) ([345b5a0](https://github.com/chrischall/accessoticketing-mcp/commit/345b5a09e7c17fec8bdf4141b7b4b45fb59077c1))


### Bug Fixes

* **build:** preserve Zod initialization in standalone bundle ([#46](https://github.com/chrischall/accessoticketing-mcp/issues/46)) ([e3b1b75](https://github.com/chrischall/accessoticketing-mcp/commit/e3b1b7507b9eb51d13ee9a871ac7666b8f85ae36))
* **mcp:** verify SDK v2 tool schema ([#47](https://github.com/chrischall/accessoticketing-mcp/issues/47)) ([b54d24a](https://github.com/chrischall/accessoticketing-mcp/commit/b54d24a1f43ed0c59314661765da0ebb702e6e21)), closes [#44](https://github.com/chrischall/accessoticketing-mcp/issues/44)

## [0.2.1](https://github.com/chrischall/accessoticketing-mcp/compare/v0.2.0...v0.2.1) (2026-09-10)


### Bug Fixes

* **deps:** @chrischall/mcp-utils 0.26.1 ([#37](https://github.com/chrischall/accessoticketing-mcp/issues/37)) ([7eb546c](https://github.com/chrischall/accessoticketing-mcp/commit/7eb546c748f1a8690be7059062d94a2c9ecae8ed))
* **deps:** declare the peer floors mcp-utils 0.26.1 requires ([#39](https://github.com/chrischall/accessoticketing-mcp/issues/39)) ([6323c6c](https://github.com/chrischall/accessoticketing-mcp/commit/6323c6c409509a4f313a1eadbfe737453ed4491d))

## [0.2.0](https://github.com/chrischall/accessoticketing-mcp/compare/v0.1.2...v0.2.0) (2026-09-04)


### Features

* **tools:** compact by default, on the projection this repo already had ([#26](https://github.com/chrischall/accessoticketing-mcp/issues/26)) ([593b10d](https://github.com/chrischall/accessoticketing-mcp/commit/593b10df205a141d9ac11ebce53cfe5fc371f156))

## [0.1.2](https://github.com/chrischall/accessoticketing-mcp/compare/v0.1.1...v0.1.2) (2026-08-28)


### Bug Fixes

* **egress:** declare every host the server dials in mint.yaml ([#13](https://github.com/chrischall/accessoticketing-mcp/issues/13)) ([f0b7435](https://github.com/chrischall/accessoticketing-mcp/commit/f0b74357c813c66f3e5ae36dc62fca245309c84e))

## [0.1.1](https://github.com/chrischall/accessoticketing-mcp/compare/v0.1.0...v0.1.1) (2026-08-18)


### Bug Fixes

* **skill:** run the ticket parser CLI when installed via symlink ([#5](https://github.com/chrischall/accessoticketing-mcp/issues/5)) ([cbc2e50](https://github.com/chrischall/accessoticketing-mcp/commit/cbc2e50c2c243815d6740c334a59618ecea16935))


### Refactor

* drop the local hint wrapper for mcp-utils 0.15's built-in ([#3](https://github.com/chrischall/accessoticketing-mcp/issues/3)) ([32ba640](https://github.com/chrischall/accessoticketing-mcp/commit/32ba6403012e78ea768010180ffdbd96ab8881b1))

## 0.1.0 (2026-08-16)


### Features

* accesso ticketing MCP server for emailed mobile ticket links ([372e58a](https://github.com/chrischall/accessoticketing-mcp/commit/372e58a0ac5cea708c34d97ea6b2bc17e5072878))
