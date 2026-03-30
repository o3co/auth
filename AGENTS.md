# Project Guidelines

## Language

- All source code, comments, variable names, function names, test descriptions, and commit messages must be written in **English only**.
- Responses to the user may be in any language.

## Purpose

This repository contains architecture documentation and cross-component E2E tests for the o3co auth platform. It does NOT contain application source code — each component lives in its own repository.

## Testing

- E2E tests validate cross-component integration (e.g., provider <-> proxy token flow).
- Use `make test-e2e` to run the full suite.
- Individual component tests live in their respective repos.
