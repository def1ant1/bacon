COMPOSE ?= docker compose
STACK_ENV ?= .env
STACK_PROFILES ?=

# Bring up the full stack with optional profiles (e.g., STACK_PROFILES=redis make stack-up)
stack-up:
	$(COMPOSE) --env-file $(STACK_ENV) --profile $(STACK_PROFILES) up --build -d

# Stop and remove containers, networks, and volumes to reset state between CI runs.
stack-down:
	$(COMPOSE) --env-file $(STACK_ENV) down --remove-orphans --volumes

stack-logs:
	$(COMPOSE) logs -f

stack-ps:
	$(COMPOSE) ps

.PHONY: stack-up stack-down stack-logs stack-ps
