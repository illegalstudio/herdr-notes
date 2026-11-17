.DEFAULT_GOAL := help
.PHONY: help release

help:
	@printf '%s\n' 'make release  Propose a version and publish a release tag'

release:
	@scripts/release.sh
