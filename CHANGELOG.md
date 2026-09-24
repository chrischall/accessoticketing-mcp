# Changelog

## [1.0.3](https://github.com/chrischall/accessoticketing-mcp/compare/v1.0.2...v1.0.3) (2026-09-24)


### Bug Fixes

* **deps:** Bump dotenv from 17.4.2 to 18.0.2 in the production-majors group ([#61](https://github.com/chrischall/accessoticketing-mcp/issues/61)) ([8f9f3f4](https://github.com/chrischall/accessoticketing-mcp/commit/8f9f3f4219b6987b4999329f5c646007c61ec694))
* **privacy:** keep the order token out of ticket read results ([#63](https://github.com/chrischall/accessoticketing-mcp/issues/63)) ([216cacd](https://github.com/chrischall/accessoticketing-mcp/commit/216cacdb142d5c8bd7977a1071a94453698fef3a))

## [1.0.2](https://github.com/chrischall/accessoticketing-mcp/compare/v1.0.1...v1.0.2) (2026-09-23)


### Bug Fixes

* correct saved/inlined barcode labelling and block SSRF in accesso_resolve_link ([#57](https://github.com/chrischall/accessoticketing-mcp/issues/57)) ([84004fa](https://github.com/chrischall/accessoticketing-mcp/commit/84004fada699e2c13aacb9d6fe680a5596530ad3))

## [1.0.1](https://github.com/chrischall/accessoticketing-mcp/compare/v1.0.0...v1.0.1) (2026-09-23)


### Bug Fixes

* **deps:** require zod ^4.6.5 to match @chrischall/mcp-utils 2.4.0 ([#56](https://github.com/chrischall/accessoticketing-mcp/issues/56)) ([263b309](https://github.com/chrischall/accessoticketing-mcp/commit/263b309fe05cbdc9f7639c813471cc2579d7091c))
* **deps:** upgrade @chrischall/mcp-utils to 2.4.0 and @fetchproxy/* to 3.2.0 ([#54](https://github.com/chrischall/accessoticketing-mcp/issues/54)) ([79c28be](https://github.com/chrischall/accessoticketing-mcp/commit/79c28beb75076920e049d7a30eaa2f3e15f1ce42))

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
