.PHONY: dev up down logs test lint build e2e backup package-offline
NODE ?= node
dev up down logs test lint build e2e backup package-offline:
	"$(NODE)" scripts/tasks.mjs $@
