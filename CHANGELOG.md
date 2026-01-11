# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Zero-copy transfer support with explicit dispatch control (`transfer`,
  `transferResult`) and automatic detection.

## [0.1.0] - 2026-01-09

### Added
- Initial release of Atelier task runtime
- Task-based API with async/await semantics
- Parallel pools with configurable worker counts
- Singleton workers for serialized execution
- Per-task backpressure with configurable queue policies (block, reject, drop-latest, drop-oldest)
- Keyed cancellation via `AbortTaskController`
- Worker crash detection with configurable recovery policies
- Runtime-scoped observability with telemetry snapshots
- `parallelLimit` utility for pipeline-level concurrency limiting
- `yieldAsCompleted` generator for streaming results
- Comprehensive documentation (README, API reference, design docs, testing guide)
- Unit and integration test suites
- Observability demo with React dashboard

[unreleased]: https://github.com/VarunKanwar/atelier/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/VarunKanwar/atelier/releases/tag/v0.1.0
