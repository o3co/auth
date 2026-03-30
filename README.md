# auth

Architecture documentation and cross-component E2E tests for the o3co auth platform.

## Components

| Component | Repository | Description |
| --- | --- | --- |
| auth.provider | [o3co/auth.provider](https://github.com/o3co/auth.provider) | OAuth 2.0 provider |
| auth.proxy | [o3co/auth.proxy](https://github.com/o3co/auth.proxy) | Token validation proxy |
| auth.verifier | (planned) | ABAC policy verifier (Rust) |
| grpc.authz | [o3co/grpc.authz](https://github.com/o3co/grpc.authz) | gRPC authorization middleware |

## Setup

```bash
make setup    # Clone all component repos
make build    # Install deps and build all components
```

## E2E Tests

```bash
make test-e2e   # Build, start services via Docker Compose, run tests, tear down
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed flow diagrams.

## License

Apache License 2.0
